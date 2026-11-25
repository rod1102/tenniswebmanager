/**
 * Mises à jour de l'application mobile servies par le site (sans Play Store ni Expo).
 *
 * Implémente le protocole « Expo Updates » v1 attendu par le module expo-updates de l'appli :
 *   GET  /manifest        → la dernière mise à jour publiée pour la version installée
 *   GET  /fichier/...     → les fichiers de la mise à jour (code de l'appli, images)
 *   GET  /version-apk     → dernière version de l'APK (changements natifs : nouvel APK à installer)
 *
 * Arborescence lue (créée par `npm run publier-maj` dans le projet de l'appli) :
 *   <dossier>/updates/<version de l'appli>/<horodatage>/metadata.json, expoConfig.json, _expo/…, assets/…
 *   <dossier>/apk.json   (facultatif) {"versionCode": 2, "version": "1.1.0", "url": "https://…/app.apk", "notes": "…"}
 *
 * Branchement dans le serveur Express du site :
 *   app.use('/api/app-mises-a-jour', require('./maj-appli/routeur')({
 *     dossier: path.join(__dirname, 'app-updates'),
 *     urlPublique: 'https://www.tenniswebmanager.com/api/app-mises-a-jour',
 *   }));
 */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ttf: 'font/ttf', otf: 'font/otf', json: 'application/json', mp3: 'audio/mpeg', wav: 'audio/wav' };
const NOM_SUR = /^[A-Za-z0-9._-]+$/;

const hashBase64Url = (buf) => crypto.createHash('sha256').update(buf).digest('base64url');
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
/** UUID stable tiré d'une empreinte (identifiant de la mise à jour). */
const uuidDe = (hex) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;

module.exports = function creerRouteurMajAppli({ dossier, urlPublique }) {
  if (!dossier || !urlPublique) throw new Error('routeur maj-appli : « dossier » et « urlPublique » sont obligatoires');
  const racineUpdates = path.join(dossier, 'updates');
  const routeur = express.Router();
  const cache = new Map(); // manifestes déjà calculés (une mise à jour publiée ne change plus)

  /** Dossier de la dernière mise à jour publiée pour une version d'appli (runtime). */
  function derniereMiseAJour(runtime) {
    if (!NOM_SUR.test(runtime)) return undefined;
    const dir = path.join(racineUpdates, runtime);
    if (!fs.existsSync(dir)) return undefined;
    const publications = fs
      .readdirSync(dir)
      .filter((n) => /^\d+$/.test(n) && fs.existsSync(path.join(dir, n, 'metadata.json')))
      .sort((a, b) => Number(b) - Number(a));
    return publications.length ? { runtime, horodatage: publications[0], chemin: path.join(dir, publications[0]) } : undefined;
  }

  function manifeste(maj, plateforme) {
    const cle = `${maj.chemin}|${plateforme}`;
    if (cache.has(cle)) return cache.get(cle);
    const metadataBrut = fs.readFileSync(path.join(maj.chemin, 'metadata.json'));
    const meta = JSON.parse(metadataBrut.toString('utf8')).fileMetadata?.[plateforme];
    if (!meta) return undefined; // pas de version pour cette plateforme
    const fichierConfig = path.join(maj.chemin, 'expoConfig.json');
    const expoClient = fs.existsSync(fichierConfig) ? JSON.parse(fs.readFileSync(fichierConfig, 'utf8')) : {};
    const url = (rel) => `${urlPublique}/fichier/${maj.runtime}/${maj.horodatage}/${rel}`;
    const decrire = (relBrut, ext, contentType) => {
      // publication faite sous Windows : metadata.json contient des « \ » (2026-11-25)
      const rel = String(relBrut).replace(/\\/g, '/');
      const contenu = fs.readFileSync(path.join(maj.chemin, rel));
      return { hash: hashBase64Url(contenu), key: md5(contenu), fileExtension: `.${ext}`, contentType, url: url(rel) };
    };
    const lancement = decrire(meta.bundle, 'bundle', 'application/javascript');
    const m = {
      id: uuidDe(crypto.createHash('sha256').update(metadataBrut).update(maj.horodatage).update(plateforme).digest('hex')),
      createdAt: new Date(Number(maj.horodatage)).toISOString(),
      runtimeVersion: maj.runtime,
      launchAsset: lancement,
      assets: (meta.assets ?? []).map((a) => decrire(a.path, a.ext, TYPES[a.ext] ?? 'application/octet-stream')),
      metadata: {},
      extra: { expoClient },
    };
    cache.set(cle, m);
    return m;
  }

  routeur.get('/manifest', (req, res) => {
    const plateforme = req.get('expo-platform') ?? req.query.platform;
    const runtime = req.get('expo-runtime-version') ?? req.query['runtime-version'];
    res.set({ 'expo-protocol-version': '1', 'expo-sfv-version': '0', 'cache-control': 'private, max-age=0' });
    if (plateforme !== 'android' && plateforme !== 'ios') return res.status(400).json({ error: 'expo-platform doit être android ou ios' });
    if (!runtime) return res.status(400).json({ error: 'expo-runtime-version manquant' });
    try {
      const maj = derniereMiseAJour(String(runtime));
      const m = maj && manifeste(maj, plateforme);
      // rien de publié pour cette version de l'appli, ou déjà installé : « pas de mise à jour »
      if (!m || req.get('expo-current-update-id') === m.id) return res.status(204).end();
      const limite = `maj-${crypto.randomBytes(8).toString('hex')}`;
      const partie = (nom, corps) => `--${limite}\r\ncontent-disposition: form-data; name="${nom}"\r\ncontent-type: application/json; charset=utf-8\r\n\r\n${JSON.stringify(corps)}\r\n`;
      // res.end (et non res.send) : Express ajouterait « ; charset=utf-8 » après la limite
      res.status(200).set('content-type', `multipart/mixed; boundary=${limite}`);
      res.end(Buffer.from(partie('manifest', m) + partie('extensions', { assetRequestHeaders: {} }) + `--${limite}--\r\n`, 'utf8'));
    } catch (e) {
      res.status(500).json({ error: `Mise à jour illisible : ${e.message}` });
    }
  });

  // Fichiers d'une mise à jour : contenu figé, mis en cache longtemps (Cloudflare compris)
  // route en expression régulière : fonctionne avec Express 4 comme avec Express 5
  routeur.get(/^\/fichier\/([A-Za-z0-9._-]+)\/(\d+)\/(.+)$/, (req, res) => {
    const runtime = req.params[0];
    const horodatage = req.params[1];
    const rel = req.params[2] ?? '';
    if (!NOM_SUR.test(runtime) || !/^\d+$/.test(horodatage) || !rel.split('/').every((s) => s && NOM_SUR.test(s) && s !== '..')) return res.status(400).end();
    const base = path.join(racineUpdates, runtime, horodatage);
    const fichier = path.join(base, rel);
    if (!fichier.startsWith(base + path.sep) || !fs.existsSync(fichier)) return res.status(404).end();
    res.set('cache-control', 'public, max-age=31536000, immutable');
    res.type(rel.endsWith('.hbc') || rel.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
    fs.createReadStream(fichier).pipe(res);
  });

  // Dernier APK disponible (changements natifs) : l'appli propose de l'installer
  routeur.get('/version-apk', (_req, res) => {
    res.set('cache-control', 'public, max-age=300');
    const f = path.join(dossier, 'apk.json');
    if (!fs.existsSync(f)) return res.status(204).end();
    try {
      res.json(JSON.parse(fs.readFileSync(f, 'utf8')));
    } catch {
      res.status(500).json({ error: 'apk.json illisible' });
    }
  });

  return routeur;
};
