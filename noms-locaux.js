// Banques de prenoms / noms "locaux" par pays, pour donner aux rivaux (et aux
// lambdas de tournoi) une identite coherente avec leur nationalite plutot qu'un
// nom pioche dans un pot generique (demande de l'utilisateur, 2026-09-10 :
// "Chris COSTA ca fait pas norvegien").
//
// IMPORTANT (demande explicite de l'utilisateur, 2026-09-10) : ces noms ne
// doivent JAMAIS evoquer un joueur reel, actuel ou historique. Les listes
// ci-dessous ne contiennent donc que des prenoms tres courants et des noms de
// famille de type "annuaire", volontairement ecartes de tous les patronymes de
// joueurs ATP/WTA connus. En complement, le patch de renommage et
// assurerRosterMinimalNation re-tirent aussi tant que le nom genere coincide avec
// celui d'un vrai personnage present en base.
//
// Cle = normaliserPays() du nom de pays (minuscule, sans accent). Chaque entree :
//   h : prenoms masculins   f : prenoms feminins   n : noms de famille
// genererNomLocal(cle, estFeminin) renvoie "Prenom NOM" (nom en MAJUSCULES) ou
// null si aucune banque pour ce pays.

const BANQUES = {
    france: {
        h: ['Julien', 'Nicolas', 'Alexandre', 'Maxime', 'Antoine', 'Romain', 'Guillaume', 'Baptiste', 'Clement', 'Florian', 'Damien', 'Sebastien'],
        f: ['Camille', 'Julie', 'Laure', 'Sarah', 'Emilie', 'Manon', 'Pauline', 'Claire', 'Amelie', 'Justine', 'Elodie', 'Charlotte'],
        n: ['Martin', 'Bernard', 'Petit', 'Durand', 'Leroy', 'Fournier', 'Bonnet', 'Lambert', 'Rousseau', 'Vincent', 'Robin', 'Morel', 'Mercier', 'Boyer', 'Guerin', 'Faure', 'Chevalier', 'Barbier', 'Marchand', 'Gaillard', 'Perrin', 'Colin', 'Meunier', 'Dumont', 'Joly', 'Riviere', 'Lemaire', 'Picard', 'Roussel', 'Dumas']
    },
    belgique: {
        h: ['Thomas', 'Nicolas', 'Simon', 'Maxime', 'Antoine', 'Julien', 'Arnaud', 'Gauthier', 'Loic', 'Corentin', 'Bastien', 'Quentin'],
        f: ['Manon', 'Julie', 'Laura', 'Sarah', 'Chloe', 'Marie', 'Camille', 'Justine', 'Ophelie', 'Margaux', 'Noemie', 'Celine'],
        n: ['Peeters', 'Janssens', 'Maes', 'Jacobs', 'Willems', 'Claes', 'Wouters', 'Goossens', 'De Smet', 'Vermeulen', 'Van Damme', 'Michiels', 'Hermans', 'De Clercq', 'Segers', 'Verhoeven', 'Lauwers', 'Servais', 'Collard', 'Nys', 'Gerard', 'Body', 'Denis', 'Renard']
    },
    suisse: {
        h: ['Lukas', 'David', 'Simon', 'Andreas', 'Matthias', 'Julien', 'Fabian', 'Nils', 'Yannick', 'Loris', 'Sven', 'Robin'],
        f: ['Lea', 'Sarah', 'Nina', 'Chiara', 'Melanie', 'Celine', 'Anouk', 'Fabienne', 'Nadia', 'Livia', 'Elin', 'Noemie'],
        n: ['Meier', 'Schmid', 'Keller', 'Weber', 'Huber', 'Schneider', 'Steiner', 'Fischer', 'Baumann', 'Frei', 'Gerber', 'Widmer', 'Wyss', 'Roth', 'Suter', 'Marti', 'Moser', 'Brunner', 'Hofer', 'Kaufmann', 'Zimmermann', 'Favre', 'Rochat', 'Perret', 'Chappuis', 'Bianchi']
    },
    espagne: {
        h: ['Javier', 'Sergio', 'Alberto', 'Miguel', 'Adrian', 'Ruben', 'Ivan', 'Marcos', 'Alvaro', 'Diego', 'Hugo', 'Mario'],
        f: ['Lucia', 'Marta', 'Ana', 'Cristina', 'Andrea', 'Nuria', 'Elena', 'Alba', 'Rocio', 'Irene', 'Nerea', 'Claudia'],
        n: ['Garcia', 'Gonzalez', 'Rodriguez', 'Fernandez', 'Lopez', 'Martinez', 'Sanchez', 'Perez', 'Gomez', 'Jimenez', 'Ruiz', 'Diaz', 'Moreno', 'Alvarez', 'Romero', 'Alonso', 'Gutierrez', 'Torres', 'Dominguez', 'Gil', 'Serrano', 'Blanco', 'Molina', 'Morales', 'Ortega', 'Delgado', 'Castro', 'Ortiz', 'Rubio', 'Marin', 'Iglesias', 'Medina']
    },
    italie: {
        h: ['Marco', 'Luca', 'Andrea', 'Alessandro', 'Davide', 'Simone', 'Federico', 'Riccardo', 'Giovanni', 'Stefano', 'Nicolo', 'Tommaso'],
        f: ['Giulia', 'Chiara', 'Francesca', 'Sara', 'Alice', 'Martina', 'Valentina', 'Elisa', 'Giorgia', 'Beatrice', 'Ilaria', 'Federica'],
        n: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Costa', 'Giordano', 'Mancini', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Mariani', 'Rinaldi', 'Caruso', 'Ferrara', 'Galli', 'Martini', 'Leone', 'Longo', 'Gentile']
    },
    allemagne: {
        h: ['Lukas', 'Jonas', 'Leon', 'Felix', 'Maximilian', 'Paul', 'Julian', 'Tim', 'Niklas', 'Jan', 'Fabian', 'Moritz'],
        f: ['Lena', 'Sophie', 'Marie', 'Laura', 'Anna', 'Lea', 'Julia', 'Katharina', 'Nele', 'Johanna', 'Clara', 'Pia'],
        n: ['Muller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Koch', 'Bauer', 'Richter', 'Klein', 'Wolf', 'Schroder', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Kruger', 'Hartmann', 'Lange', 'Werner', 'Krause', 'Lehmann', 'Schmitt', 'Meier', 'Konig', 'Walter', 'Huber', 'Kaiser']
    },
    'royaume-uni': {
        h: ['Jack', 'Oliver', 'Harry', 'George', 'Thomas', 'James', 'William', 'Charlie', 'Oscar', 'Henry', 'Alfie', 'Freddie'],
        f: ['Olivia', 'Amelia', 'Isla', 'Sophie', 'Grace', 'Lily', 'Freya', 'Charlotte', 'Ella', 'Poppy', 'Millie', 'Daisy'],
        n: ['Smith', 'Jones', 'Taylor', 'Brown', 'Wilson', 'Johnson', 'Davies', 'Robinson', 'Wright', 'Thompson', 'Walker', 'White', 'Roberts', 'Green', 'Hall', 'Wood', 'Harris', 'Martin', 'Jackson', 'Clarke', 'Turner', 'Hill', 'Cooper', 'Ward', 'Morris', 'Baker', 'Cox', 'Richardson', 'Bell', 'Bailey', 'Carter', 'Foster']
    },
    'pays-bas': {
        h: ['Daan', 'Sem', 'Lucas', 'Levi', 'Milan', 'Luuk', 'Thijs', 'Bram', 'Jesse', 'Sven', 'Ruben', 'Stijn'],
        f: ['Emma', 'Julia', 'Sophie', 'Zoe', 'Lieke', 'Fenna', 'Sara', 'Anouk', 'Noor', 'Eva', 'Roos', 'Fleur'],
        n: ['De Jong', 'Jansen', 'De Vries', 'Van den Berg', 'Van Dijk', 'Bakker', 'Janssen', 'Visser', 'Smit', 'Meijer', 'De Boer', 'Mulder', 'De Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'Van Leeuwen', 'Dekker', 'Brouwer', 'De Wit', 'Dijkstra', 'Smits', 'De Graaf', 'Van der Meer', 'Van der Linden', 'Kok', 'Jacobs', 'Kramer', 'Van Dam']
    },
    autriche: {
        h: ['Lukas', 'David', 'Tobias', 'Julian', 'Fabian', 'Florian', 'Matthias', 'Simon', 'Jakob', 'Elias', 'Felix', 'Moritz'],
        f: ['Anna', 'Lena', 'Julia', 'Sarah', 'Laura', 'Lea', 'Marie', 'Hannah', 'Katharina', 'Nina', 'Sophie', 'Vanessa'],
        n: ['Gruber', 'Huber', 'Bauer', 'Wagner', 'Muller', 'Pichler', 'Steiner', 'Moser', 'Mayer', 'Hofer', 'Leitner', 'Berger', 'Fuchs', 'Eder', 'Fischer', 'Schmid', 'Winkler', 'Weber', 'Schwarz', 'Maier', 'Schneider', 'Reiter', 'Lang', 'Baumgartner', 'Auer', 'Binder', 'Wimmer', 'Aigner']
    },
    portugal: {
        h: ['Joao', 'Diogo', 'Tiago', 'Miguel', 'Ricardo', 'Andre', 'Bruno', 'Rui', 'Nuno', 'Goncalo', 'Pedro', 'Filipe'],
        f: ['Ana', 'Beatriz', 'Ines', 'Mariana', 'Carolina', 'Sofia', 'Catarina', 'Rita', 'Joana', 'Margarida', 'Leonor', 'Marta'],
        n: ['Silva', 'Santos', 'Ferreira', 'Pereira', 'Oliveira', 'Costa', 'Rodrigues', 'Martins', 'Jesus', 'Sousa', 'Fernandes', 'Goncalves', 'Gomes', 'Lopes', 'Marques', 'Alves', 'Almeida', 'Ribeiro', 'Pinto', 'Carvalho', 'Teixeira', 'Moreira', 'Correia', 'Mendes', 'Nunes', 'Soares', 'Vieira', 'Monteiro', 'Cardoso', 'Rocha']
    },
    norvege: {
        h: ['Emil', 'Noah', 'Oliver', 'William', 'Lucas', 'Filip', 'Jakob', 'Oskar', 'Mathias', 'Henrik', 'Magnus', 'Elias'],
        f: ['Nora', 'Emma', 'Sofie', 'Ella', 'Maja', 'Ingrid', 'Frida', 'Sara', 'Thea', 'Julie', 'Ida', 'Amalie'],
        n: ['Hansen', 'Johansen', 'Olsen', 'Larsen', 'Andersen', 'Nilsen', 'Pedersen', 'Kristiansen', 'Jensen', 'Karlsen', 'Johnsen', 'Pettersen', 'Eriksen', 'Berg', 'Haugen', 'Hagen', 'Johannessen', 'Andreassen', 'Jacobsen', 'Halvorsen', 'Moen', 'Iversen', 'Strand', 'Nygaard', 'Lund', 'Bakke', 'Amundsen']
    },
    suede: {
        h: ['William', 'Oscar', 'Hugo', 'Lucas', 'Elias', 'Alexander', 'Axel', 'Emil', 'Anton', 'Viktor', 'Ludvig', 'Isak'],
        f: ['Alice', 'Maja', 'Elsa', 'Astrid', 'Wilma', 'Ella', 'Alva', 'Ebba', 'Julia', 'Klara', 'Nova', 'Saga'],
        n: ['Andersson', 'Johansson', 'Karlsson', 'Nilsson', 'Eriksson', 'Larsson', 'Olsson', 'Persson', 'Svensson', 'Gustafsson', 'Pettersson', 'Jonsson', 'Jansson', 'Hansson', 'Bengtsson', 'Lindberg', 'Jakobsson', 'Magnusson', 'Olofsson', 'Lindstrom', 'Lindqvist', 'Lindgren', 'Axelsson', 'Bergstrom', 'Lundberg', 'Lundgren', 'Berglund', 'Sandberg', 'Forsberg', 'Sjoberg']
    },
    danemark: {
        h: ['William', 'Oscar', 'Lucas', 'Victor', 'Malthe', 'Emil', 'Alfred', 'Carl', 'Aksel', 'August', 'Noah', 'Villads'],
        f: ['Emma', 'Ida', 'Clara', 'Laura', 'Josefine', 'Sofie', 'Anna', 'Alma', 'Karla', 'Freja', 'Ella', 'Agnes'],
        n: ['Nielsen', 'Jensen', 'Hansen', 'Pedersen', 'Andersen', 'Christensen', 'Larsen', 'Sorensen', 'Rasmussen', 'Jorgensen', 'Petersen', 'Madsen', 'Kristensen', 'Olsen', 'Thomsen', 'Christiansen', 'Poulsen', 'Johansen', 'Knudsen', 'Mortensen', 'Damgaard', 'Holst', 'Bech', 'Dahl', 'Vestergaard', 'Skov', 'Toft']
    },
    finlande: {
        h: ['Elias', 'Onni', 'Leo', 'Eino', 'Aatos', 'Vaino', 'Niilo', 'Oliver', 'Emil', 'Joel', 'Aaro', 'Kasper'],
        f: ['Aino', 'Eevi', 'Emilia', 'Sofia', 'Aada', 'Venla', 'Helmi', 'Ella', 'Iida', 'Lilja', 'Siiri', 'Olivia'],
        n: ['Korhonen', 'Virtanen', 'Makinen', 'Nieminen', 'Makela', 'Hamalainen', 'Laine', 'Heikkinen', 'Koskinen', 'Jarvinen', 'Lehtonen', 'Lehtinen', 'Saarinen', 'Salminen', 'Heinonen', 'Niemi', 'Heikkila', 'Kinnunen', 'Salonen', 'Turunen', 'Salo', 'Laitinen', 'Tuominen', 'Rantanen', 'Karjalainen', 'Jokinen', 'Mattila', 'Savolainen']
    },
    pologne: {
        h: ['Jakub', 'Kacper', 'Antoni', 'Filip', 'Jan', 'Szymon', 'Franciszek', 'Mikolaj', 'Wojciech', 'Aleksander', 'Bartosz', 'Igor'],
        f: ['Zofia', 'Julia', 'Maja', 'Hanna', 'Lena', 'Alicja', 'Maria', 'Oliwia', 'Amelia', 'Wiktoria', 'Antonina', 'Aleksandra'],
        n: ['Nowak', 'Kowalski', 'Wisniewski', 'Wojcik', 'Kowalczyk', 'Kaminski', 'Lewandowski', 'Zielinski', 'Szymanski', 'Wozniak', 'Dabrowski', 'Kozlowski', 'Jankowski', 'Mazur', 'Kwiatkowski', 'Krawczyk', 'Piotrowski', 'Grabowski', 'Nowakowski', 'Pawlowski', 'Michalski', 'Nowicki', 'Adamczyk', 'Dudek', 'Zajac', 'Wieczorek', 'Jablonski', 'Krol', 'Majewski', 'Olszewski']
    },
    'republique tcheque': {
        h: ['Jakub', 'Jan', 'Tomas', 'Adam', 'Matej', 'Vojtech', 'Filip', 'Ondrej', 'David', 'Lukas', 'Martin', 'Daniel'],
        f: ['Eliska', 'Tereza', 'Anna', 'Adela', 'Natalie', 'Karolina', 'Kristyna', 'Barbora', 'Sofie', 'Viktorie', 'Ema', 'Nela'],
        n: ['Novak', 'Svoboda', 'Novotny', 'Dvorak', 'Cerny', 'Prochazka', 'Kucera', 'Vesely', 'Horak', 'Nemec', 'Marek', 'Pospisil', 'Pokorny', 'Hajek', 'Kral', 'Jelinek', 'Ruzicka', 'Fiala', 'Sedlacek', 'Dolezal', 'Zeman', 'Kolar', 'Navratil', 'Cermak', 'Vanek', 'Urban', 'Blazek', 'Kratochvil']
    },
    croatie: {
        h: ['Luka', 'David', 'Jakov', 'Ivan', 'Marko', 'Petar', 'Ante', 'Josip', 'Matej', 'Filip', 'Roko', 'Bruno'],
        f: ['Mia', 'Ema', 'Lucija', 'Petra', 'Sara', 'Marta', 'Ana', 'Dora', 'Lana', 'Nika', 'Klara', 'Iva'],
        n: ['Horvat', 'Kovacevic', 'Babic', 'Maric', 'Juric', 'Novak', 'Kovacic', 'Vukovic', 'Knezevic', 'Markovic', 'Petrovic', 'Matic', 'Tomic', 'Pavlovic', 'Kovac', 'Blazevic', 'Grgic', 'Bozic', 'Peric', 'Radic', 'Filipovic', 'Simunovic', 'Jurcevic', 'Katic', 'Kralj', 'Milic', 'Perkovic', 'Vidovic']
    },
    serbie: {
        h: ['Luka', 'Vuk', 'Nikola', 'Stefan', 'Milan', 'Marko', 'Aleksa', 'Lazar', 'Mihajlo', 'Filip', 'Petar', 'Dusan'],
        f: ['Sofija', 'Milica', 'Teodora', 'Ana', 'Jovana', 'Katarina', 'Anja', 'Sara', 'Iva', 'Mila', 'Andjela', 'Dunja'],
        n: ['Jovanovic', 'Petrovic', 'Nikolic', 'Markovic', 'Djordjevic', 'Stojanovic', 'Ilic', 'Stankovic', 'Pavlovic', 'Milosevic', 'Popovic', 'Kostic', 'Ristic', 'Milic', 'Todorovic', 'Simic', 'Lukic', 'Mitrovic', 'Jankovic', 'Zivkovic', 'Cvetkovic', 'Vasic', 'Radovanovic', 'Savic', 'Krstic', 'Filipovic', 'Ninkovic', 'Aleksic']
    },
    grece: {
        h: ['Georgios', 'Ioannis', 'Konstantinos', 'Dimitrios', 'Nikolaos', 'Panagiotis', 'Vasileios', 'Christos', 'Athanasios', 'Andreas', 'Spyridon', 'Emmanouil'],
        f: ['Maria', 'Eleni', 'Aikaterini', 'Vasiliki', 'Sofia', 'Anna', 'Georgia', 'Dimitra', 'Konstantina', 'Christina', 'Ioanna', 'Panagiota'],
        n: ['Papadopoulos', 'Vlachos', 'Angelopoulos', 'Nikolaou', 'Georgiou', 'Dimitriou', 'Pappas', 'Konstantinou', 'Oikonomou', 'Ioannou', 'Antoniou', 'Makris', 'Karagiannis', 'Panagiotou', 'Michailidis', 'Athanasiou', 'Christodoulou', 'Stavrou', 'Alexiou', 'Vasileiou', 'Petridis', 'Samaras', 'Fotiou', 'Manolis', 'Kokkinos', 'Andreou', 'Theodorou', 'Lambrou']
    },
    roumanie: {
        h: ['Andrei', 'David', 'Alexandru', 'Stefan', 'Mihai', 'Gabriel', 'Ionut', 'Rares', 'Darius', 'Vlad', 'Luca', 'Matei'],
        f: ['Maria', 'Ioana', 'Andreea', 'Elena', 'Ana', 'Alexandra', 'Gabriela', 'Bianca', 'Daria', 'Sofia', 'Antonia', 'Teodora'],
        n: ['Popescu', 'Ionescu', 'Popa', 'Radu', 'Dumitru', 'Stan', 'Stoica', 'Gheorghe', 'Constantin', 'Marin', 'Barbu', 'Nistor', 'Florea', 'Tudor', 'Dinu', 'Lazar', 'Ilie', 'Serban', 'Diaconu', 'Munteanu', 'Ene', 'Voicu', 'Sava', 'Neagu', 'Vasilescu', 'Toma', 'Preda', 'Iordache']
    },
    bulgarie: {
        h: ['Georgi', 'Aleksandar', 'Martin', 'Nikola', 'Kaloyan', 'Viktor', 'Ivan', 'Dimitar', 'Stefan', 'Boris', 'Yosif', 'Simeon'],
        f: ['Maria', 'Viktoria', 'Raya', 'Nikol', 'Gabriela', 'Aleksandra', 'Kaloyana', 'Bozhidara', 'Sofia', 'Yoana', 'Dária', 'Mila'],
        n: ['Ivanov', 'Georgiev', 'Dimitrov', 'Petrov', 'Nikolov', 'Kolev', 'Stoyanov', 'Todorov', 'Angelov', 'Hristov', 'Marinov', 'Iliev', 'Vasilev', 'Yordanov', 'Popov', 'Kostov', 'Atanasov', 'Mihaylov', 'Stefanov', 'Kirilov', 'Aleksandrov', 'Peev', 'Rusev', 'Zlatanov', 'Borisov', 'Grozev', 'Draganov']
    },
    hongrie: {
        h: ['Bence', 'Mate', 'Levente', 'Marton', 'Balazs', 'Adam', 'Daniel', 'David', 'Peter', 'Gergo', 'Zoltan', 'Andras'],
        f: ['Hanna', 'Anna', 'Zsofia', 'Luca', 'Emma', 'Nora', 'Reka', 'Panna', 'Boglarka', 'Lili', 'Dorka', 'Fanni'],
        n: ['Nagy', 'Kovacs', 'Toth', 'Szabo', 'Horvath', 'Varga', 'Kiss', 'Molnar', 'Nemeth', 'Farkas', 'Balogh', 'Papp', 'Takacs', 'Juhasz', 'Lakatos', 'Meszaros', 'Olah', 'Simon', 'Racz', 'Fekete', 'Szilagyi', 'Torok', 'Fabian', 'Biro', 'Katona', 'Balazs', 'Sandor', 'Antal']
    },
    russie: {
        h: ['Artem', 'Maxim', 'Timofey', 'Mikhail', 'Kirill', 'Egor', 'Ivan', 'Dmitri', 'Sergei', 'Roman', 'Nikita', 'Pavel'],
        f: ['Sofia', 'Maria', 'Anna', 'Viktoria', 'Polina', 'Alisa', 'Kira', 'Vera', 'Vasilisa', 'Taisiya', 'Margarita', 'Alina'],
        n: ['Ivanov', 'Smirnov', 'Kuznetsov', 'Popov', 'Sokolov', 'Lebedev', 'Kozlov', 'Novikov', 'Morozov', 'Petrov', 'Volkov', 'Solovyov', 'Vasilyev', 'Zaitsev', 'Pavlov', 'Semenov', 'Golubev', 'Vinogradov', 'Bogdanov', 'Vorobyov', 'Fedorov', 'Mikhailov', 'Belyaev', 'Tarasov', 'Belov', 'Komarov', 'Orlov', 'Kiselev']
    },
    ukraine: {
        h: ['Nazar', 'Maksym', 'Mykhailo', 'Artem', 'Dmytro', 'Ivan', 'Danylo', 'Bogdan', 'Andriy', 'Yaroslav', 'Denys', 'Vladyslav'],
        f: ['Sofia', 'Anastasia', 'Kateryna', 'Yeva', 'Solomiya', 'Diana', 'Zlata', 'Veronika', 'Marta', 'Yaryna', 'Darina', 'Milana'],
        n: ['Melnyk', 'Shevchenko', 'Boyko', 'Kovalenko', 'Bondarenko', 'Tkachenko', 'Kravchenko', 'Kovalchuk', 'Koval', 'Oliynyk', 'Shevchuk', 'Polishchuk', 'Bondar', 'Tkachuk', 'Savchenko', 'Rudenko', 'Lysenko', 'Marchenko', 'Pavlenko', 'Klymenko', 'Moroz', 'Zhuk', 'Onyshchenko', 'Panchenko', 'Romanenko', 'Sydorenko', 'Danylenko']
    },
    'etats-unis': {
        h: ['Mason', 'Logan', 'Ethan', 'Jackson', 'Aiden', 'Carter', 'Wyatt', 'Grayson', 'Hunter', 'Landon', 'Cole', 'Brady'],
        f: ['Ava', 'Harper', 'Ella', 'Scarlett', 'Grace', 'Lily', 'Aubrey', 'Addison', 'Brooke', 'Peyton', 'Riley', 'Hailey'],
        n: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Anderson', 'Thomas', 'Moore', 'Jackson', 'Martin', 'Thompson', 'Harris', 'Clark', 'Lewis', 'Walker', 'Hall', 'Allen', 'Young', 'King', 'Wright', 'Scott', 'Green', 'Adams', 'Baker', 'Nelson', 'Carter', 'Mitchell', 'Roberts', 'Turner', 'Phillips', 'Campbell', 'Parker', 'Evans', 'Edwards', 'Collins', 'Stewart', 'Morris']
    },
    canada: {
        h: ['Liam', 'Noah', 'Owen', 'Ethan', 'Jack', 'Nathan', 'Cole', 'Hudson', 'Carson', 'Nolan', 'Bennett', 'Grayson'],
        f: ['Emma', 'Olivia', 'Charlotte', 'Ava', 'Chloe', 'Ella', 'Aria', 'Nora', 'Harper', 'Zoe', 'Brooklyn', 'Aubrey'],
        n: ['Roy', 'Tremblay', 'Gagnon', 'Cote', 'Bouchard', 'Gauthier', 'Morin', 'Lavoie', 'Fortin', 'Gagne', 'Ouellet', 'Pelletier', 'Belanger', 'Levesque', 'Bergeron', 'Girard', 'Cloutier', 'Fournier', 'Poirier', 'Simard', 'MacDonald', 'Campbell', 'Anderson', 'Wilson', 'Stewart', 'Reid', 'Ross', 'Scott', 'Thomson', 'Cameron']
    },
    argentine: {
        h: ['Mateo', 'Benjamin', 'Bautista', 'Santino', 'Thiago', 'Lautaro', 'Joaquin', 'Nicolas', 'Lucas', 'Valentino', 'Franco', 'Ignacio'],
        f: ['Sofia', 'Isabella', 'Emma', 'Valentina', 'Martina', 'Catalina', 'Julieta', 'Delfina', 'Renata', 'Mia', 'Victoria', 'Emilia'],
        n: ['Gonzalez', 'Rodriguez', 'Gomez', 'Fernandez', 'Lopez', 'Diaz', 'Martinez', 'Perez', 'Garcia', 'Sanchez', 'Romero', 'Sosa', 'Alvarez', 'Torres', 'Ruiz', 'Ramirez', 'Flores', 'Acosta', 'Benitez', 'Medina', 'Suarez', 'Herrera', 'Aguirre', 'Pereyra', 'Gimenez', 'Ferreyra', 'Rios', 'Moreno', 'Godoy', 'Cabrera']
    },
    bresil: {
        h: ['Miguel', 'Arthur', 'Heitor', 'Bernardo', 'Davi', 'Lucas', 'Pedro', 'Gabriel', 'Enzo', 'Matheus', 'Rafael', 'Bruno'],
        f: ['Alice', 'Sophia', 'Helena', 'Valentina', 'Laura', 'Manuela', 'Julia', 'Isabella', 'Luiza', 'Beatriz', 'Mariana', 'Cecilia'],
        n: ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Ferreira', 'Almeida', 'Costa', 'Rodrigues', 'Gomes', 'Martins', 'Araujo', 'Ribeiro', 'Carvalho', 'Barbosa', 'Rocha', 'Dias', 'Nascimento', 'Andrade', 'Moraes', 'Nunes', 'Cardoso', 'Teixeira', 'Correia', 'Cavalcanti', 'Freitas', 'Miranda', 'Barros', 'Pinheiro']
    },
    chili: {
        h: ['Benjamin', 'Vicente', 'Martin', 'Agustin', 'Maximiliano', 'Tomas', 'Matias', 'Joaquin', 'Cristobal', 'Lucas', 'Diego', 'Gaspar'],
        f: ['Sofia', 'Isidora', 'Emilia', 'Antonella', 'Florencia', 'Josefa', 'Trinidad', 'Amanda', 'Fernanda', 'Catalina', 'Agustina', 'Javiera'],
        n: ['Gonzalez', 'Munoz', 'Rojas', 'Diaz', 'Perez', 'Soto', 'Contreras', 'Silva', 'Martinez', 'Sepulveda', 'Morales', 'Rodriguez', 'Lopez', 'Fuentes', 'Hernandez', 'Torres', 'Araya', 'Flores', 'Espinoza', 'Valenzuela', 'Castillo', 'Tapia', 'Reyes', 'Gutierrez', 'Castro', 'Pizarro', 'Alvarez', 'Vergara', 'Fernandez', 'Carrasco']
    },
    mexique: {
        h: ['Santiago', 'Mateo', 'Sebastian', 'Leonardo', 'Emiliano', 'Diego', 'Miguel', 'Alexander', 'Daniel', 'Angel', 'Adrian', 'Gael'],
        f: ['Sofia', 'Regina', 'Valentina', 'Ximena', 'Camila', 'Renata', 'Victoria', 'Maria', 'Fernanda', 'Isabella', 'Andrea', 'Natalia'],
        n: ['Hernandez', 'Garcia', 'Martinez', 'Lopez', 'Gonzalez', 'Perez', 'Sanchez', 'Ramirez', 'Cruz', 'Flores', 'Gomez', 'Morales', 'Vazquez', 'Reyes', 'Jimenez', 'Torres', 'Diaz', 'Gutierrez', 'Mendoza', 'Ruiz', 'Alvarez', 'Castillo', 'Moreno', 'Romero', 'Herrera', 'Medina', 'Aguilar', 'Vargas', 'Guzman', 'Rivera']
    },
    australie: {
        h: ['Oliver', 'Jack', 'William', 'Noah', 'Thomas', 'Lucas', 'Cooper', 'Lachlan', 'Hunter', 'Mason', 'Riley', 'Hudson'],
        f: ['Charlotte', 'Olivia', 'Amelia', 'Isla', 'Mia', 'Grace', 'Willow', 'Harper', 'Chloe', 'Sophie', 'Zoe', 'Ruby'],
        n: ['Smith', 'Jones', 'Williams', 'Brown', 'Wilson', 'Taylor', 'Johnson', 'White', 'Martin', 'Anderson', 'Walker', 'Ryan', 'Kelly', 'King', 'Robinson', 'Harris', 'Clarke', 'Lee', 'Wright', 'Campbell', 'Hall', 'Mitchell', 'Scott', 'Cooper', 'Bailey', 'Murphy', 'Bennett', 'Roberts', 'Cook', 'Fraser', 'Dixon', 'Barnes']
    },
    japon: {
        h: ['Haruto', 'Sota', 'Yuto', 'Ren', 'Riku', 'Kaito', 'Hiroto', 'Yuma', 'Sora', 'Takumi', 'Ryota', 'Kenta'],
        f: ['Hina', 'Yui', 'Aoi', 'Rin', 'Sakura', 'Mio', 'Yuna', 'Ichika', 'Akari', 'Mei', 'Koharu', 'Saki'],
        n: ['Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada', 'Sasaki', 'Yamaguchi', 'Matsumoto', 'Inoue', 'Kimura', 'Hayashi', 'Shimizu', 'Yamazaki', 'Mori', 'Abe', 'Ikeda', 'Hashimoto', 'Yamashita', 'Ishikawa', 'Nakajima', 'Maeda', 'Fujita', 'Ogawa']
    },
    chine: {
        h: ['Hao', 'Yang', 'Chen', 'Jie', 'Lei', 'Bo', 'Kai', 'Jun', 'Feng', 'Tao', 'Ming', 'Peng'],
        f: ['Yan', 'Jing', 'Fang', 'Na', 'Ting', 'Xue', 'Hui', 'Ling', 'Mei', 'Ying', 'Lan', 'Dan'],
        n: ['Wang', 'Li', 'Zhang', 'Liu', 'Chen', 'Yang', 'Huang', 'Zhao', 'Wu', 'Zhou', 'Xu', 'Sun', 'Ma', 'Zhu', 'Hu', 'Guo', 'He', 'Gao', 'Lin', 'Luo', 'Zheng', 'Liang', 'Xie', 'Song', 'Tang', 'Han', 'Feng', 'Deng', 'Cao', 'Peng']
    },
    'coree du sud': {
        h: ['Min-jun', 'Seo-jun', 'Do-yun', 'Ji-ho', 'Ha-jun', 'Yu-jun', 'Eun-woo', 'Si-woo', 'Joon-woo', 'Hyun-woo', 'Ji-hoon', 'Tae-yang'],
        f: ['Seo-yeon', 'Ha-eun', 'Ji-woo', 'Ha-yoon', 'Seo-ah', 'Ji-yoo', 'Soo-ah', 'Ye-eun', 'Da-eun', 'Chae-won', 'Yu-na', 'So-yul'],
        n: ['Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Jang', 'Lim', 'Han', 'Oh', 'Seo', 'Shin', 'Kwon', 'Hwang', 'Ahn', 'Song', 'Jeon', 'Hong', 'Yoo', 'Ko', 'Moon', 'Yang', 'Bae', 'Baek', 'Nam', 'Noh']
    },
    inde: {
        h: ['Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Reyansh', 'Krishna', 'Ishaan', 'Kabir', 'Rohan', 'Aryan', 'Dev', 'Vihaan'],
        f: ['Aanya', 'Diya', 'Saanvi', 'Ananya', 'Aadhya', 'Myra', 'Kavya', 'Anika', 'Riya', 'Ira', 'Prisha', 'Navya'],
        n: ['Sharma', 'Verma', 'Gupta', 'Kumar', 'Singh', 'Patel', 'Reddy', 'Nair', 'Menon', 'Iyer', 'Rao', 'Joshi', 'Chauhan', 'Mehta', 'Shah', 'Agarwal', 'Bhat', 'Pillai', 'Desai', 'Kapoor', 'Malhotra', 'Chopra', 'Bose', 'Das', 'Sen', 'Banerjee', 'Chatterjee', 'Mukherjee', 'Naidu', 'Prasad']
    },
    kazakhstan: {
        h: ['Alikhan', 'Nurislam', 'Adilkhan', 'Sanzhar', 'Alinur', 'Yerkebulan', 'Dias', 'Arman', 'Nurdaulet', 'Ratmir', 'Alibek', 'Rasul'],
        f: ['Aisha', 'Amina', 'Madina', 'Aruzhan', 'Aylin', 'Dilnaz', 'Ayana', 'Malika', 'Aruzhan', 'Adema', 'Zhansaya', 'Symbat'],
        n: ['Akhmetov', 'Ospanov', 'Iskakov', 'Abenov', 'Serikov', 'Bekov', 'Suleimenov', 'Nurlanov', 'Amanov', 'Dzhaksybekov', 'Kaliev', 'Sagyndykov', 'Tuleuov', 'Yerzhanov', 'Bektursynov', 'Musin', 'Omarov', 'Zhaksylykov', 'Aitkozhin', 'Baigaliev', 'Kenzhebekov', 'Zhumagaliev']
    },
    tunisie: {
        h: ['Youssef', 'Mohamed', 'Ahmed', 'Aziz', 'Wassim', 'Nour', 'Rayan', 'Bilel', 'Skander', 'Hamza', 'Iheb', 'Firas'],
        f: ['Nour', 'Farah', 'Yasmine', 'Maryam', 'Rania', 'Ines', 'Sarra', 'Molka', 'Emna', 'Chaima', 'Baraa', 'Eya'],
        n: ['Ben Salah', 'Trabelsi', 'Gharbi', 'Jelassi', 'Mejri', 'Chaabane', 'Nasri', 'Khelifi', 'Bouazizi', 'Hamdi', 'Karoui', 'Amri', 'Sassi', 'Ferchichi', 'Bouzid', 'Chebbi', 'Guesmi', 'Hachicha', 'Zaidi', 'Khemiri', 'Baccouche', 'Jaziri', 'Rekik', 'Ayadi']
    },
    maroc: {
        h: ['Youssef', 'Adam', 'Rayan', 'Mohamed', 'Yassine', 'Ilyas', 'Amine', 'Anas', 'Ayman', 'Nizar', 'Zakaria', 'Bilal'],
        f: ['Lina', 'Aya', 'Salma', 'Nour', 'Malak', 'Ghita', 'Rim', 'Douae', 'Imane', 'Hiba', 'Sara', 'Yasmine'],
        n: ['El Amrani', 'Bennani', 'Alaoui', 'Tazi', 'Cherkaoui', 'Bouazza', 'El Idrissi', 'Naciri', 'Sqalli', 'Benjelloun', 'El Fassi', 'Berrada', 'Chraibi', 'Lahlou', 'Kabbaj', 'El Malki', 'Ouazzani', 'Sebti', 'Bennis', 'Tahiri', 'El Ghazali', 'Amrani', 'Sabri', 'Hakimi']
    },
    'afrique du sud': {
        h: ['Liam', 'Ethan', 'Daniel', 'Luke', 'Michael', 'Ryan', 'Joshua', 'David', 'Matthew', 'James', 'Dylan', 'Connor'],
        f: ['Emma', 'Amara', 'Hannah', 'Chloe', 'Ava', 'Sophie', 'Isabella', 'Mia', 'Zoe', 'Kayla', 'Lily', 'Erin'],
        n: ['Van der Merwe', 'Botha', 'Nel', 'Pretorius', 'Van Wyk', 'Fourie', 'Venter', 'Kruger', 'Coetzee', 'Meyer', 'Steyn', 'Naidoo', 'Pillay', 'Govender', 'Dlamini', 'Nkosi', 'Mokoena', 'Ndlovu', 'Khumalo', 'Mahlangu', 'Van Zyl', 'Du Plessis', 'Joubert', 'Swanepoel', 'Le Roux', 'Erasmus', 'Marais', 'Van Rooyen']
    },
    curacao: {
        h: ['Dwayne', 'Shawn', 'Kevin', 'Roberto', 'Franklin', 'Ryan', 'Elton', 'Giovanni', 'Marcel', 'Rodney', 'Dennis', 'Orlando'],
        f: ['Shaira', 'Denise', 'Kimberley', 'Nathalie', 'Gwenda', 'Charissa', 'Michelle', 'Angela', 'Sherry', 'Lisette', 'Priscilla', 'Melissa'],
        n: ['Martina', 'Statia', 'Isenia', 'Girigori', 'Cijntje', 'Doran', 'Nicolaas', 'Willems', 'Semeleer', 'Kolader', 'Winklaar', 'Leito', 'Gario', 'Franka', 'Pikeri', 'Djaoen', 'Semerel', 'Bakhuis', 'Anthony', 'Wiel', 'Jansen', 'Constansia', 'Damascus', 'Kleinmoedig']
    },
    monaco: {
        h: ['Lucas', 'Hugo', 'Valentin', 'Romain', 'Benjamin', 'Thomas', 'Antoine', 'Louis', 'Gauthier', 'Nils', 'Adrien', 'Paul'],
        f: ['Charlotte', 'Pauline', 'Camille', 'Margaux', 'Elodie', 'Sophie', 'Laetitia', 'Manon', 'Chloe', 'Alice', 'Julie', 'Emma'],
        n: ['Marsan', 'Notari', 'Crovetto', 'Aureglia', 'Pastor', 'Rey', 'Gastaud', 'Boeri', 'Campana', 'Lorenzi', 'Bernardi', 'Peglion', 'Viale', 'Ferrero', 'Giordano', 'Marquet', 'Palmaro', 'Battaglia', 'Fissore', 'Poyet']
    },
    andorre: {
        h: ['Jordi', 'Marc', 'Pol', 'Guillem', 'Adria', 'Roger', 'Bernat', 'Aleix', 'Ferran', 'Oriol', 'Arnau', 'Marti'],
        f: ['Nuria', 'Berta', 'Cristina', 'Gemma', 'Laia', 'Judith', 'Anna', 'Meritxell', 'Carla', 'Mireia', 'Ariadna', 'Clara'],
        n: ['Areny', 'Marfany', 'Font', 'Cornella', 'Babi', 'Moles', 'Gili', 'Naudi', 'Armengol', 'Calva', 'Rossell', 'Betriu', 'Pintat', 'Casal', 'Baro', 'Duro', 'Montane', 'Aleix', 'Molne', 'Torres']
    },
    bahamas: {
        h: ['Justin', 'Kevin', 'Jody', 'Marvin', 'Spencer', 'Devin', 'Elijah', 'Trevor', 'Donte', 'Shane', 'Brent', 'Cordero'],
        f: ['Simone', 'Sydney', 'Kerrie', 'Nikkita', 'Elana', 'Larissa', 'Brianna', 'Kelsie', 'Danielle', 'Alexis', 'Shaunae', 'Tynia'],
        n: ['Newman', 'Rolle', 'Cartwright', 'Bethel', 'Munnings', 'Pratt', 'Ferguson', 'Sweeting', 'Stubbs', 'Bain', 'Adderley', 'Deveaux', 'Butler', 'Curry', 'Sands', 'Miller', 'Turnquest', 'Hield', 'Culmer', 'Strachan']
    },
    barbade: {
        h: ['Darian', 'Russell', 'Seanon', 'Matthew', 'Trevon', 'Julian', 'Andre', 'Marcus', 'Damian', 'Chad', 'Rashad', 'Kemar'],
        f: ['Sabina', 'Aisha', 'Danielle', 'Shakira', 'Renee', 'Britney', 'Amara', 'Zoe', 'Shania', 'Tia', 'Krystle', 'Akela'],
        n: ['Clarke', 'Deane', 'Gooding', 'Farmer', 'Holder', 'Yearwood', 'Blackman', 'Griffith', 'Alleyne', 'Marshall', 'Prescod', 'Weekes', 'Beckles', 'Grazette', 'Trotman', 'Belgrave', 'Straughn', 'Carrington', 'Boyce', 'Best']
    },
    liechtenstein: {
        h: ['Lukas', 'Nico', 'Marco', 'Fabian', 'Julian', 'Simon', 'Elias', 'David', 'Andreas', 'Michael', 'Tobias', 'Jonas'],
        f: ['Lena', 'Sophie', 'Anna', 'Julia', 'Nina', 'Marie', 'Laura', 'Sarah', 'Lea', 'Hannah', 'Elena', 'Chiara'],
        n: ['Hasler', 'Buchel', 'Frommelt', 'Ospelt', 'Wolff', 'Marxer', 'Kaiser', 'Beck', 'Vogt', 'Ritter', 'Nigg', 'Frick', 'Wille', 'Sele', 'Meier', 'Schadler', 'Batliner', 'Gassner', 'Hoop', 'Konrad']
    },
    samoa: {
        h: ['Steven', 'Brandon', 'Manoa', 'Junior', 'Leo', 'Marlon', 'Ika', 'Tavita', 'Savea', 'Lote', 'Fetu', 'Iosefa'],
        f: ['Elena', 'Sina', 'Litara', 'Moana', 'Talia', 'Rosita', 'Malia', 'Lupe', 'Filomena', 'Salote', 'Teuila', 'Manuia'],
        n: ['Leota', 'Ioane', 'Sialaoa', 'Tuala', 'Faletau', 'Pauli', 'Fesuiai', 'Ah Chong', 'Su\'a', 'Tuiletufuga', 'Levi', 'Faleolo', 'Meredith', 'Toleafoa', 'Enari', 'Iakopo', 'Pati', 'Sio', 'Amosa', 'Ale']
    }
};

function choix(liste) {
    return liste[Math.floor(Math.random() * liste.length)];
}

// Renvoie "Prenom NOM" adapte au pays, ou null si aucune banque pour ce pays.
// `cle` doit deja etre passe dans normaliserPays() par l'appelant.
function genererNomLocal(cle, estFeminin) {
    const b = BANQUES[cle];
    if (!b) return null;
    const prenoms = estFeminin ? b.f : b.h;
    if (!prenoms || prenoms.length === 0 || !b.n || b.n.length === 0) return null;
    return choix(prenoms) + ' ' + choix(b.n).toUpperCase();
}

function aBanque(cle) {
    return !!BANQUES[cle];
}

module.exports = { genererNomLocal, aBanque, BANQUES };
