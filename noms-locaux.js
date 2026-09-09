// Banques de prenoms / noms "locaux" par pays, pour donner aux rivaux (et aux
// lambdas de tournoi) une identite coherente avec leur nationalite plutot qu'un
// nom pioche dans un pot generique (demande explicite de l'utilisateur,
// 2026-09-10 : "Chris COSTA ca fait pas norvegien").
//
// Cle = normaliserPays() du nom de pays (minuscule, sans accent). Chaque entree :
//   h : prenoms masculins   f : prenoms feminins   n : noms de famille
// genererNomLocal(cle, estFeminin) renvoie "Prenom NOM" (nom en MAJUSCULES comme
// partout ailleurs dans le jeu) ou null si aucune banque pour ce pays.

const BANQUES = {
    france: {
        h: ['Gael', 'Lucas', 'Hugo', 'Adrian', 'Corentin', 'Benoit', 'Julien', 'Arthur', 'Theo', 'Quentin', 'Maxime', 'Antoine'],
        f: ['Caroline', 'Alize', 'Oceane', 'Chloe', 'Diane', 'Fiona', 'Clara', 'Elsa', 'Manon', 'Lea', 'Pauline', 'Jade'],
        n: ['Monfils', 'Gasquet', 'Simon', 'Pouille', 'Mahut', 'Herbert', 'Rinderknech', 'Moutet', 'Humbert', 'Garcia', 'Cornet', 'Mladenovic', 'Dubois', 'Lestienne', 'Barrere', 'Halys']
    },
    belgique: {
        h: ['David', 'Steve', 'Kimmer', 'Ruben', 'Joris', 'Sander', 'Zizou', 'Christophe', 'Arthur', 'Gilles'],
        f: ['Kim', 'Elise', 'Yanina', 'Alison', 'Greet', 'Ysaline', 'Maryna', 'Lara', 'Sofia', 'Margaux'],
        n: ['Goffin', 'Bemelmans', 'Coppejans', 'Darcis', 'Malisse', 'Rochus', 'Mertens', 'Wickmayer', 'Flipkens', 'Van Uytvanck', 'Zanevska', 'Minnen', 'Geerts', 'De Greef']
    },
    suisse: {
        h: ['Roger', 'Stan', 'Marco', 'Henri', 'Dominic', 'Leandro', 'Jerome', 'Alexander', 'Remy', 'Kilian'],
        f: ['Belinda', 'Viktorija', 'Jil', 'Stefanie', 'Ylena', 'Simona', 'Celine', 'Susan', 'Timea', 'Lulu'],
        n: ['Federer', 'Wawrinka', 'Chiudinelli', 'Laaksonen', 'Huesler', 'Riedi', 'Kym', 'Bencic', 'Golubic', 'Teichmann', 'In-Albon', 'Bacsinszky', 'Waltert', 'Vogele']
    },
    espagne: {
        h: ['Carlos', 'Rafael', 'Pablo', 'Roberto', 'Alejandro', 'Fernando', 'Pedro', 'Jaume', 'Nicolas', 'Bernabe', 'Albert', 'Feliciano'],
        f: ['Garbine', 'Paula', 'Sara', 'Nuria', 'Cristina', 'Rebeka', 'Aliona', 'Marina', 'Silvia', 'Carla', 'Lara', 'Angela'],
        n: ['Nadal', 'Alcaraz', 'Ferrer', 'Carreno', 'Bautista', 'Davidovich', 'Munar', 'Ramos', 'Verdasco', 'Andujar', 'Munoz', 'Badosa', 'Muguruza', 'Sorribes', 'Bolsova', 'Navarro']
    },
    italie: {
        h: ['Jannik', 'Matteo', 'Lorenzo', 'Fabio', 'Marco', 'Andrea', 'Flavio', 'Luca', 'Stefano', 'Gianluca', 'Simone', 'Francesco'],
        f: ['Camila', 'Martina', 'Jasmine', 'Sara', 'Elisabetta', 'Lucia', 'Nuria', 'Lucrezia', 'Federica', 'Giulia', 'Bianca', 'Elisa'],
        n: ['Sinner', 'Berrettini', 'Musetti', 'Fognini', 'Sonego', 'Arnaldi', 'Cobolli', 'Nardi', 'Bolelli', 'Vavassori', 'Giorgi', 'Paolini', 'Trevisan', 'Cocciaretto', 'Bronzetti', 'Errani']
    },
    allemagne: {
        h: ['Alexander', 'Jan-Lennard', 'Dominik', 'Yannick', 'Daniel', 'Oscar', 'Maximilian', 'Peter', 'Cedrik', 'Kevin', 'Tobias', 'Henri'],
        f: ['Angelique', 'Laura', 'Tatjana', 'Jule', 'Eva', 'Anna-Lena', 'Tamara', 'Nastasja', 'Mona', 'Julia', 'Andrea', 'Ella'],
        n: ['Zverev', 'Struff', 'Koepfer', 'Hanfmann', 'Altmaier', 'Otte', 'Marterer', 'Gojowczyk', 'Kohlschreiber', 'Molleker', 'Kerber', 'Siegemund', 'Friedsam', 'Maria', 'Korpatsch', 'Niemeier']
    },
    'royaume-uni': {
        h: ['Andy', 'Cameron', 'Daniel', 'Jack', 'Kyle', 'Liam', 'Jamie', 'Paul', 'Ryan', 'Billy'],
        f: ['Emma', 'Katie', 'Heather', 'Harriet', 'Jodie', 'Francesca', 'Sonay', 'Naomi', 'Freya', 'Anne'],
        n: ['Murray', 'Norrie', 'Evans', 'Draper', 'Edmund', 'Broady', 'Fery', 'Choinski', 'Clarke', 'Watson', 'Boulter', 'Raducanu', 'Dart', 'Burrage', 'Kartal', 'Nicholls']
    },
    'pays-bas': {
        h: ['Botic', 'Tallon', 'Tim', 'Robin', 'Jesper', 'Gijs', 'Sander', 'Jelle', 'Ryan', 'Guy'],
        f: ['Kiki', 'Arantxa', 'Suzan', 'Lesley', 'Demi', 'Indy', 'Eva', 'Bibiane', 'Quirine', 'Richel'],
        n: ['Van de Zandschulp', 'Griekspoor', 'Haase', 'Brouwer', 'De Jong', 'Van Rijthoven', 'Middelkoop', 'Koolhof', 'Bertens', 'Rus', 'Pattinama', 'Kerkhove', 'Lamens', 'Hogenkamp', 'Schuurs']
    },
    autriche: {
        h: ['Dominic', 'Jurij', 'Dennis', 'Sebastian', 'Filip', 'Lucas', 'Jonas', 'David', 'Gerald', 'Andreas'],
        f: ['Julia', 'Barbara', 'Sinja', 'Melanie', 'Lisa', 'Sandra', 'Yvonne', 'Tamira', 'Mira', 'Arabella'],
        n: ['Thiem', 'Rodionov', 'Novak', 'Ofner', 'Misolic', 'Neumayer', 'Melzer', 'Haider-Maurer', 'Grabher', 'Klaffner', 'Paszek', 'Kremen', 'Reingruber', 'Schmiedlova']
    },
    portugal: {
        h: ['Joao', 'Nuno', 'Frederico', 'Gastao', 'Pedro', 'Duarte', 'Henrique', 'Tiago', 'Bernardo', 'Rui'],
        f: ['Francisca', 'Ines', 'Matilde', 'Angelina', 'Beatriz', 'Sara', 'Maria', 'Joana', 'Rita', 'Leonor'],
        n: ['Sousa', 'Borges', 'Silva', 'Elias', 'Faria', 'Domingues', 'Rocha', 'Ferreira', 'Cabral', 'Monteiro', 'Jorge', 'Fernandes', 'Correia', 'Santos']
    },
    norvege: {
        h: ['Casper', 'Lars', 'Ole', 'Hakon', 'Erik', 'Anders', 'Magnus', 'Jonas', 'Henrik', 'Sander', 'Viktor', 'Kristian'],
        f: ['Ingrid', 'Astrid', 'Kari', 'Nora', 'Marte', 'Silje', 'Emma', 'Malene', 'Frida', 'Thea', 'Sofie', 'Ida'],
        n: ['Ruud', 'Hansen', 'Johansen', 'Olsen', 'Larsen', 'Berg', 'Haugen', 'Nilsen', 'Solberg', 'Bakken', 'Dahl', 'Lie', 'Moe', 'Strand', 'Aas', 'Ovrebo']
    },
    suede: {
        h: ['Bjorn', 'Stefan', 'Mats', 'Erik', 'Gustav', 'Anders', 'Elias', 'Lucas', 'Filip', 'Nils', 'Karl', 'Oscar'],
        f: ['Rebecca', 'Johanna', 'Sara', 'Elin', 'Astrid', 'Linnea', 'Klara', 'Maja', 'Ida', 'Nora', 'Ebba', 'Alva'],
        n: ['Borg', 'Edberg', 'Wilander', 'Larsson', 'Andersson', 'Nystrom', 'Ekstrom', 'Lindqvist', 'Soderling', 'Bergstrom', 'Holm', 'Ymer', 'Ekelund', 'Sjolin', 'Falk']
    },
    danemark: {
        h: ['Holger', 'Mikael', 'Frederik', 'August', 'Kasper', 'Elmer', 'Johannes', 'Christian', 'Soren', 'Emil'],
        f: ['Caroline', 'Clara', 'Maria', 'Emma', 'Ida', 'Josephine', 'Freja', 'Laura', 'Sofie', 'Anna'],
        n: ['Rune', 'Carlsen', 'Kristiansen', 'Moller', 'Tabur', 'Torpegaard', 'Nielsen', 'Pedersen', 'Jorgensen', 'Wozniacki', 'Tauson', 'Bramsen', 'Beck', 'Klein']
    },
    finlande: {
        h: ['Emil', 'Otto', 'Patrik', 'Harri', 'Eero', 'Aku', 'Kaarlo', 'Mikko', 'Juho', 'Leo'],
        f: ['Emma', 'Anna', 'Laura', 'Ella', 'Oona', 'Aino', 'Sanni', 'Nea', 'Iida', 'Venla'],
        n: ['Ruusuvuori', 'Virtanen', 'Heliovaara', 'Kontinen', 'Nykanen', 'Lehtinen', 'Makinen', 'Korhonen', 'Laine', 'Salminen', 'Kanepi', 'Hartono']
    },
    pologne: {
        h: ['Hubert', 'Kamil', 'Michal', 'Jan', 'Kacper', 'Maks', 'Daniel', 'Piotr', 'Lukasz', 'Filip'],
        f: ['Iga', 'Magda', 'Magdalena', 'Alicja', 'Katarzyna', 'Weronika', 'Maja', 'Paula', 'Zuzanna', 'Julia'],
        n: ['Hurkacz', 'Majchrzak', 'Kubler', 'Walkow', 'Zielinski', 'Kwiatkowski', 'Swiatek', 'Linette', 'Frech', 'Rosolska', 'Kawa', 'Chwalinska', 'Piter']
    },
    'republique tcheque': {
        h: ['Tomas', 'Jiri', 'Jakub', 'Vit', 'Zdenek', 'Dalibor', 'Lukas', 'Petr', 'Adam', 'Ondrej'],
        f: ['Petra', 'Karolina', 'Barbora', 'Marketa', 'Katerina', 'Linda', 'Tereza', 'Marie', 'Sara', 'Nikola'],
        n: ['Berdych', 'Lehecka', 'Machac', 'Vesely', 'Kolar', 'Mensik', 'Kvitova', 'Pliskova', 'Krejcikova', 'Vondrousova', 'Muchova', 'Bouzkova', 'Siniakova', 'Noskova']
    },
    croatie: {
        h: ['Marin', 'Borna', 'Ivan', 'Nino', 'Mate', 'Dino', 'Luka', 'Duje', 'Antun', 'Toni'],
        f: ['Donna', 'Petra', 'Ana', 'Jana', 'Mirjam', 'Tena', 'Lea', 'Antonia', 'Iva', 'Nika'],
        n: ['Cilic', 'Coric', 'Dodig', 'Serdarusic', 'Gojo', 'Prizmic', 'Vekic', 'Martic', 'Lucic', 'Fett', 'Jurak', 'Konjuh', 'Ruzic']
    },
    serbie: {
        h: ['Novak', 'Dusan', 'Miomir', 'Laslo', 'Filip', 'Hamad', 'Nikola', 'Danilo', 'Stefan', 'Marko'],
        f: ['Ana', 'Jelena', 'Olga', 'Aleksandra', 'Nina', 'Natalija', 'Dejana', 'Lola', 'Ivana', 'Teodora'],
        n: ['Djokovic', 'Lajovic', 'Kecmanovic', 'Djere', 'Krajinovic', 'Medjedovic', 'Ivanovic', 'Jankovic', 'Danilovic', 'Stojanovic', 'Krunic', 'Olujic', 'Kostovic']
    },
    grece: {
        h: ['Stefanos', 'Petros', 'Michail', 'Aristotelis', 'Ioannis', 'Markos', 'Alexandros', 'Dimitrios', 'Nikolaos', 'Konstantinos'],
        f: ['Maria', 'Despina', 'Eleni', 'Valentini', 'Sofia', 'Anna', 'Dimitra', 'Katerina', 'Georgia', 'Ioanna'],
        n: ['Tsitsipas', 'Sakkari', 'Pervolarakis', 'Grammatikopoulos', 'Kalovelonis', 'Papamichail', 'Christopoulos', 'Sakellaridis', 'Tsakiri', 'Baltas']
    },
    roumanie: {
        h: ['Horia', 'Marius', 'Nicholas', 'Filip', 'Gabi', 'Radu', 'Dragos', 'Bogdan', 'Victor', 'Andrei'],
        f: ['Simona', 'Sorana', 'Ana', 'Irina', 'Jaqueline', 'Gabriela', 'Elena', 'Monica', 'Patricia', 'Miriam'],
        n: ['Tecau', 'Copil', 'Hanescu', 'Jianu', 'Cretu', 'Coman', 'Halep', 'Cirstea', 'Begu', 'Ruse', 'Bara', 'Niculescu', 'Bogdan', 'Mitu']
    },
    bulgarie: {
        h: ['Grigor', 'Dimitar', 'Alexandar', 'Yanaki', 'Adrian', 'Petar', 'Ivan', 'Georgi', 'Nikolay', 'Simon'],
        f: ['Tsvetana', 'Viktoriya', 'Isabella', 'Elitsa', 'Julia', 'Gergana', 'Denislava', 'Petia', 'Aleksandrina', 'Lia'],
        n: ['Dimitrov', 'Kuzmanov', 'Lazarov', 'Donski', 'Andreev', 'Nedelchev', 'Pironkova', 'Tomova', 'Shinikova', 'Kostova', 'Vangelova', 'Karagyozova']
    },
    hongrie: {
        h: ['Marton', 'Fabian', 'Zsombor', 'Attila', 'Mate', 'Peter', 'Gabor', 'Zsolt', 'Adam', 'Daniel'],
        f: ['Timea', 'Anna', 'Dalma', 'Reka', 'Panna', 'Fanni', 'Adrienn', 'Vanda', 'Amarissa', 'Luca'],
        n: ['Fucsovics', 'Marozsan', 'Piros', 'Balazs', 'Nagy', 'Toth', 'Babos', 'Bondar', 'Galfi', 'Udvardy', 'Stollar', 'Jani']
    },
    russie: {
        h: ['Daniil', 'Andrey', 'Karen', 'Aslan', 'Roman', 'Pavel', 'Evgeny', 'Dmitry', 'Alexander', 'Timofey'],
        f: ['Daria', 'Ekaterina', 'Anna', 'Veronika', 'Ludmila', 'Anastasia', 'Liudmila', 'Polina', 'Kamilla', 'Oksana'],
        n: ['Medvedev', 'Rublev', 'Khachanov', 'Karatsev', 'Safiullin', 'Kotov', 'Samsonova', 'Kasatkina', 'Pavlyuchenkova', 'Alexandrova', 'Kudermetova', 'Blinkova', 'Gracheva', 'Potapova']
    },
    ukraine: {
        h: ['Illya', 'Vitaliy', 'Oleksii', 'Eric', 'Vladyslav', 'Bogdan', 'Danylo', 'Andriy', 'Sergiy', 'Oleg'],
        f: ['Elina', 'Marta', 'Dayana', 'Lesia', 'Anhelina', 'Kateryna', 'Yuliia', 'Daria', 'Nadiia', 'Valeriya'],
        n: ['Marchenko', 'Sachko', 'Krutykh', 'Vasylenko', 'Ovcharenko', 'Svitolina', 'Kostyuk', 'Yastremska', 'Tsurenko', 'Kalinina', 'Snigur', 'Zavatska', 'Bondarenko']
    },
    'etats-unis': {
        h: ['Taylor', 'Frances', 'Tommy', 'Sebastian', 'Ben', 'Reilly', 'Mackenzie', 'Christopher', 'Marcos', 'Brandon', 'Jenson', 'Aleksandar'],
        f: ['Coco', 'Jessica', 'Madison', 'Danielle', 'Sofia', 'Amanda', 'Peyton', 'Emma', 'Ashlyn', 'Alycia', 'Caroline', 'Hailey'],
        n: ['Fritz', 'Tiafoe', 'Paul', 'Korda', 'Shelton', 'Opelka', 'McDonald', 'Eubanks', 'Giron', 'Nakashima', 'Kozlov', 'Gauff', 'Pegula', 'Keys', 'Collins', 'Navarro', 'Kenin', 'Stephens']
    },
    canada: {
        h: ['Denis', 'Felix', 'Milos', 'Vasek', 'Gabriel', 'Alexis', 'Liam', 'Steven', 'Kelsey', 'Cleeve'],
        f: ['Bianca', 'Leylah', 'Gabriela', 'Rebecca', 'Carol', 'Katherine', 'Marina', 'Layne', 'Cadence', 'Kayla'],
        n: ['Shapovalov', 'Auger-Aliassime', 'Raonic', 'Pospisil', 'Diallo', 'Galarneau', 'Draxl', 'Andreescu', 'Fernandez', 'Dabrowski', 'Marino', 'Bouchard', 'Sebov', 'Branstine']
    },
    argentine: {
        h: ['Diego', 'Francisco', 'Sebastian', 'Federico', 'Tomas', 'Juan', 'Facundo', 'Guido', 'Pedro', 'Mariano'],
        f: ['Nadia', 'Paula', 'Julia', 'Maria', 'Lourdes', 'Solana', 'Jazmin', 'Guillermina', 'Berta', 'Melany'],
        n: ['Schwartzman', 'Cerundolo', 'Baez', 'Coria', 'Etcheverry', 'Navone', 'Diaz Acosta', 'Bagnis', 'Londero', 'Podoroska', 'Carle', 'Sabatini', 'Ormaechea', 'Riera']
    },
    bresil: {
        h: ['Thiago', 'Joao', 'Gustavo', 'Felipe', 'Thiago', 'Marcelo', 'Bruno', 'Rafael', 'Orlando', 'Mateus'],
        f: ['Beatriz', 'Laura', 'Luisa', 'Carolina', 'Ingrid', 'Gabriela', 'Teliana', 'Nathalia', 'Rebeca', 'Ana'],
        n: ['Monteiro', 'Fonseca', 'Seyboth Wild', 'Meligeni', 'Melo', 'Matos', 'Haddad Maia', 'Pigossi', 'Stefani', 'Alves', 'Bhering', 'Oliveira', 'Costa', 'Pereira']
    },
    chili: {
        h: ['Nicolas', 'Cristian', 'Alejandro', 'Tomas', 'Marcelo', 'Gonzalo', 'Matias', 'Bastian', 'Daniel', 'Diego'],
        f: ['Barbara', 'Alexa', 'Fernanda', 'Daniela', 'Camila', 'Antonia', 'Ivania', 'Bianca', 'Valentina', 'Fresia'],
        n: ['Jarry', 'Garin', 'Tabilo', 'Barrios', 'Nunez', 'Fillol', 'Rios', 'Massu', 'Gonzalez', 'Guarachi', 'Seguel', 'Vodanovic']
    },
    mexique: {
        h: ['Rodrigo', 'Ernesto', 'Alex', 'Gerardo', 'Miguel', 'Luis', 'Manuel', 'Santiago', 'Emilio', 'Rafael'],
        f: ['Renata', 'Fernanda', 'Marcela', 'Victoria', 'Ana', 'Jimena', 'Giuliana', 'Camila', 'Regina', 'Daniela'],
        n: ['Zapata', 'Escoto', 'Hernandez', 'Lopez', 'Gonzalez', 'Reyes-Varela', 'Zarazua', 'Contreras', 'Cruz', 'Estrella', 'Villasenor', 'Morales']
    },
    australie: {
        h: ['Alex', 'Nick', 'Jordan', 'Thanasi', 'Christopher', 'James', 'Aleksandar', 'Rinky', 'Max', 'Jason'],
        f: ['Ashleigh', 'Ajla', 'Daria', 'Storm', 'Kimberly', 'Priscilla', 'Olivia', 'Talia', 'Maddison', 'Arina'],
        n: ['De Minaur', 'Kyrgios', 'Thompson', 'Kokkinakis', "O'Connell", 'Duckworth', 'Vukic', 'Hijikata', 'Purcell', 'Barty', 'Tomljanovic', 'Saville', 'Hunter', 'Sharma', 'Gadecki']
    },
    japon: {
        h: ['Kei', 'Yoshihito', 'Taro', 'Shintaro', 'Yosuke', 'Sho', 'Rio', 'Hiroki', 'James', 'Kaito'],
        f: ['Naomi', 'Misaki', 'Nao', 'Moyuka', 'Ena', 'Mai', 'Kurumi', 'Himeno', 'Sara', 'Aoi'],
        n: ['Nishikori', 'Nishioka', 'Daniel', 'Mochizuki', 'Watanuki', 'Shimabukuro', 'Osaka', 'Doi', 'Uchijima', 'Hibino', 'Naito', 'Sakatsume', 'Hosogi']
    },
    chine: {
        h: ['Zhizhen', 'Yibing', 'Juncheng', 'Rigele', 'Bu', 'Fajing', 'Aoran', 'Xiaofei', 'Zihao', 'Mo'],
        f: ['Qinwen', 'Shuai', 'Lin', 'Xinyu', 'Xiyu', 'Yafan', 'Saisai', 'Fangzhou', 'Ruoxue', 'Yue'],
        n: ['Zhang', 'Wu', 'Shang', 'Sun', 'Yunchaokete', 'Zhou', 'Zheng', 'Wang', 'Gao', 'Yuan', 'Bai', 'Zhu', 'Han']
    },
    'coree du sud': {
        h: ['Hyeon', 'Soonwoo', 'Seongchan', 'Gijeong', 'Eubin', 'Duckhee', 'Hong', 'Minkyu', 'Jisung', 'Jeong'],
        f: ['Su-Jeong', 'Na-Lae', 'Dabin', 'Yerin', 'Da-Eun', 'Eugenie', 'Hyun-Woo', 'Ha-Young', 'So-Hyun', 'Ji-Hee'],
        n: ['Chung', 'Kwon', 'Hong', 'Nam', 'Lee', 'Kim', 'Shin', 'Park', 'Jang', 'Han', 'Cho', 'Yoon']
    },
    inde: {
        h: ['Sumit', 'Yuki', 'Ramkumar', 'Prajnesh', 'Sasikumar', 'Digvijay', 'Arjun', 'Rohan', 'Sriram', 'Karan'],
        f: ['Ankita', 'Sania', 'Karman', 'Riya', 'Rutuja', 'Prarthana', 'Sahaja', 'Shrivalli', 'Vaidehi', 'Zeel'],
        n: ['Nagal', 'Bhambri', 'Ramanathan', 'Gunneswaran', 'Mukund', 'Balaji', 'Sharan', 'Bopanna', 'Raina', 'Mirza', 'Thombare', 'Bhosale', 'Rina']
    },
    kazakhstan: {
        h: ['Alexander', 'Mikhail', 'Timofey', 'Dmitry', 'Beibit', 'Denis', 'Grigoriy', 'Amir', 'Aslan', 'Maxim'],
        f: ['Elena', 'Yulia', 'Zhibek', 'Anna', 'Zarina', 'Gozal', 'Aruzhan', 'Kamila', 'Yekaterina', 'Asylzhan'],
        n: ['Bublik', 'Kukushkin', 'Skatov', 'Popko', 'Nedovyesov', 'Shevchenko', 'Rybakina', 'Putintseva', 'Danilina', 'Diyas', 'Voronina', 'Zhilova']
    },
    tunisie: {
        h: ['Malek', 'Aziz', 'Skander', 'Moez', 'Anis', 'Youssef', 'Wael', 'Hazem', 'Slim', 'Aymen'],
        f: ['Ons', 'Chiraz', 'Nour', 'Feryel', 'Yasmine', 'Ines', 'Sarra', 'Molka', 'Rania', 'Emna'],
        n: ['Jaziri', 'Dougaz', 'Chelli', 'Jabeur', 'Bejaoui', 'Ben Ali', 'Ghorbel', 'Trabelsi', 'Hammami', 'Nefzi', 'Klibi', 'Ayari']
    },
    maroc: {
        h: ['Reda', 'Elliot', 'Younes', 'Amine', 'Adam', 'Yassine', 'Mehdi', 'Anas', 'Walid', 'Achraf'],
        f: ['Lina', 'Aya', 'Ghita', 'Salma', 'Nour', 'Sara', 'Imane', 'Yasmine', 'Rita', 'Kenza'],
        n: ['El Aynaoui', 'Benchetrit', 'Moundir', 'Lamsalak', 'Bennani', 'Ouahabi', 'El Allami', 'Kabbaj', 'Sqalli', 'Idrissi', 'Fassi', 'Berrada']
    },
    'afrique du sud': {
        h: ['Lloyd', 'Kevin', 'Raven', 'Philip', 'Ruan', 'Wayne', 'Jason', 'Nik', 'Kris', 'Alec'],
        f: ['Chanel', 'Zoe', 'Lee', 'Isabella', 'Minette', 'Kelly', 'Chanelle', 'Delien', 'Madrie', 'Amber'],
        n: ['Harris', 'Anderson', 'Klaasen', 'Henin', 'Roelofse', 'Montgomery', 'Simmonds', 'Ferreira', 'Scholtz', 'Du Toit', 'Van der Merwe', 'Botha']
    },
    curacao: {
        h: ['Jean-Julien', 'Jandino', 'Churandy', 'Tahitona', 'Roshendell', 'Kevin', 'Gimno', 'Shairon', 'Rangelo', 'Darryl'],
        f: ['Xayenne', 'Shanice', 'Kimberly', 'Chelsea', 'Naomi', 'Denia', 'Sharella', 'Quionette', 'Reainy', 'Britt'],
        n: ['Rojer', 'Martina', 'Bonevacia', 'Statia', 'Isenia', 'Girigori', 'Cijntje', 'Martis', 'Elhage', 'Sille', 'Doran', 'Pieters']
    },
    monaco: {
        h: ['Lucas', 'Hugo', 'Valentin', 'Romain', 'Benjamin', 'Thomas', 'Antoine', 'Louis', 'Gauthier', 'Nils'],
        f: ['Charlotte', 'Pauline', 'Camille', 'Margaux', 'Elodie', 'Sophie', 'Laetitia', 'Manon', 'Chloe', 'Alice'],
        n: ['Catarina', 'Fissore', 'Marsan', 'Poyet', 'Grinda', 'Vatrican', 'Roux', 'Notari', 'Crovetto', 'Aureglia', 'Pastor', 'Rey']
    },
    andorre: {
        h: ['Jordi', 'Marc', 'Pol', 'Guillem', 'Adria', 'Roger', 'Bernat', 'Aleix', 'Ferran', 'Oriol'],
        f: ['Vicky', 'Nuria', 'Berta', 'Cristina', 'Gemma', 'Laia', 'Judith', 'Anna', 'Meritxell', 'Carla'],
        n: ['Jimenez', 'Vitores', 'Rodriguez', 'Areny', 'Marfany', 'Font', 'Cornella', 'Babi', 'Riba', 'Sanchez', 'Moles', 'Gili']
    },
    bahamas: {
        h: ['Baker', 'Justin', 'Kevin', 'Jody', 'Marvin', 'Spencer', 'Devin', 'Elijah', 'Trevor', 'Donte'],
        f: ['Simone', 'Sydney', 'Kerrie', 'Nikkita', 'Elana', 'Larissa', 'Brianna', 'Kelsie', 'Danielle', 'Alexis'],
        n: ['Newman', 'Roberts', 'Major', 'Rolle', 'Cartwright', 'Bethel', 'Sturrup', 'Munnings', 'Pratt', 'Ferguson', 'Knowles', 'Sweeting']
    },
    barbade: {
        h: ['Haydn', 'Darian', 'Russell', 'Seanon', 'Matthew', 'Trevon', 'Julian', 'Andre', 'Marcus', 'Damian'],
        f: ['Emma', 'Sabina', 'Aisha', 'Danielle', 'Shakira', 'Renee', 'Britney', 'Nkosana', 'Amara', 'Zoe'],
        n: ['King', 'Clarke', 'Deane', 'Gooding', 'Farmer', 'Holder', 'Yearwood', 'Blackman', 'Griffith', 'Alleyne', 'Marshall', 'Prescod']
    },
    liechtenstein: {
        h: ['Lukas', 'Nico', 'Marco', 'Fabian', 'Julian', 'Simon', 'Elias', 'David', 'Andreas', 'Michael'],
        f: ['Kathinka', 'Stephanie', 'Lena', 'Sophie', 'Anna', 'Julia', 'Nina', 'Marie', 'Laura', 'Sarah'],
        n: ['von Deichmann', 'Hasler', 'Buchel', 'Frommelt', 'Ospelt', 'Wolff', 'Marxer', 'Kaiser', 'Beck', 'Vogt', 'Ritter', 'Nigg']
    },
    samoa: {
        h: ['Steven', 'Brandon', 'Tuiloma', 'Alatasi', 'Manoa', 'Faapito', 'Junior', 'Leo', 'Marlon', 'Ika'],
        f: ['Elena', 'Sina', 'Litara', 'Moana', 'Talia', 'Vaili', 'Rosita', 'Malia', 'Fetu', 'Lupe'],
        n: ['Fepuleai', 'Tapusoa', 'Ah Kuoi', 'Leota', 'Toomalatai', 'Ioane', 'Faasavalu', 'Sialaoa', 'Purcell', 'Malielegaoi', 'Retzlaff', 'Tuala']
    }
};

function choix(liste) {
    return liste[Math.floor(Math.random() * liste.length)];
}

// Renvoie "Prenom NOM" adapte au pays, ou null si pas de banque pour ce pays.
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
