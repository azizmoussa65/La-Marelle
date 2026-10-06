-- ================= SCHÉMA POSTGRESQL – La Marelle (école préparatoire) =================
-- Deux espaces : Administration, Parents.
-- Les élèves (petits) n'ont pas de compte : leurs parents se connectent avec leur numéro de téléphone.

-- Numéro de téléphone → clé de comparaison (chiffres seuls, sans « 00 » ni « 216 » devant un numéro tunisien)
-- « +216 20 100 200 », « 0021620100200 » et « 20 100 200 » donnent tous « 20100200 »
CREATE OR REPLACE FUNCTION tel_cle(t TEXT) RETURNS TEXT IMMUTABLE LANGUAGE sql AS $$
  SELECT NULLIF(CASE WHEN d ~ '^216\d{8}$' THEN substr(d, 4) ELSE d END, '')
  FROM (SELECT regexp_replace(regexp_replace(coalesce(t, ''), '\D', '', 'g'), '^00', '') AS d) x
$$;

-- Fichiers envoyés depuis l'appareil (photos, PDF), stockés dans la base
-- (le disque des hébergeurs gratuits est effacé à chaque redémarrage)
CREATE TABLE IF NOT EXISTS fichiers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom        TEXT NOT NULL,
  type       TEXT NOT NULL,
  taille     INTEGER NOT NULL,
  contenu    BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comptes : administration (email), parents (numéro de téléphone)
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  nom        TEXT NOT NULL,
  email      TEXT UNIQUE,                              -- administration
  telephone  TEXT,
  tel_cle    TEXT,                                     -- parents : identifiant de connexion
  password   TEXT NOT NULL,                            -- haché avec bcrypt
  role       TEXT NOT NULL CHECK (role IN ('admin', 'parent')),
  photo_id   UUID REFERENCES fichiers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (role = 'parent' OR email IS NOT NULL),
  CHECK (role <> 'parent' OR tel_cle IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_parent_tel ON users(tel_cle) WHERE role = 'parent';

-- Classes : « قسم تحضيري ياسمين », « قسم تحضيري فل », « قسم تحضيري أقحوان »… (page « Classes »)
CREATE TABLE IF NOT EXISTS classes (
  nom        TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Profil de l'élève, rempli par l'administration. Ses parents = les comptes dont le numéro
-- est celui du père ou de la mère (un même numéro sur 3 élèves → 3 enfants dans le même espace)
CREATE TABLE IF NOT EXISTS eleves (
  id             SERIAL PRIMARY KEY,
  nom            TEXT NOT NULL,
  classe         TEXT NOT NULL REFERENCES classes(nom) ON UPDATE CASCADE,
  date_naissance DATE,
  nom_pere       TEXT,
  tel_pere       TEXT,
  nom_mere       TEXT,
  tel_mere       TEXT,
  infos          TEXT,                                 -- santé, allergies, personne autorisée à récupérer l'enfant…
  photo_id       UUID REFERENCES fichiers(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (tel_pere IS NOT NULL OR tel_mere IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_eleves_pere ON eleves(tel_cle(tel_pere));
CREATE INDEX IF NOT EXISTS idx_eleves_mere ON eleves(tel_cle(tel_mere));
CREATE INDEX IF NOT EXISTS idx_eleves_classe ON eleves(classe);

-- Emploi du temps : une photo (ou un PDF) par classe, envoyée par l'administration aux parents de la classe
CREATE TABLE IF NOT EXISTS emplois (
  classe     TEXT PRIMARY KEY REFERENCES classes(nom) ON UPDATE CASCADE ON DELETE CASCADE,
  photo_id   UUID NOT NULL REFERENCES fichiers(id),
  cree_par   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Appel fait par l'administration ; chaque absence part dans l'Espace Parents (+ notification)
CREATE TABLE IF NOT EXISTS absences (
  id               SERIAL PRIMARY KEY,
  eleve_id         INTEGER NOT NULL REFERENCES eleves(id) ON DELETE CASCADE,
  classe           TEXT NOT NULL,
  date             DATE NOT NULL,
  creneau          TEXT NOT NULL,                      -- « Journée » ou un créneau (08:00-10:00…)
  faite_par        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (eleve_id, date, creneau)
);
CREATE INDEX IF NOT EXISTS idx_absences_date ON absences(date);

-- Cours du jour et travail à la maison : photos prises par l'administration, envoyées aux parents de la classe
CREATE TABLE IF NOT EXISTS publications (
  id          SERIAL PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('cours', 'travail')),
  classe      TEXT NOT NULL REFERENCES classes(nom) ON UPDATE CASCADE ON DELETE CASCADE,
  matiere     TEXT NOT NULL,
  date        DATE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cree_par    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_publications ON publications(classe, type, date DESC);
-- Plusieurs photos par publication (une par page du cahier)
CREATE TABLE IF NOT EXISTS publication_fichiers (
  publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  fichier_id     UUID NOT NULL REFERENCES fichiers(id) ON DELETE CASCADE,
  ordre          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (publication_id, fichier_id)
);

CREATE TABLE IF NOT EXISTS evenements (
  id         SERIAL PRIMARY KEY,
  nom        TEXT NOT NULL,
  lieu       TEXT NOT NULL,
  date       DATE NOT NULL,
  heure      TEXT NOT NULL,
  image_id   UUID REFERENCES fichiers(id) ON DELETE SET NULL,
  cree_par   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Messages des parents (réclamation, certificat médical…) → administration
CREATE TABLE IF NOT EXISTS reclamations (
  id            SERIAL PRIMARY KEY,
  parent_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  eleve_id      INTEGER REFERENCES eleves(id) ON DELETE SET NULL,
  type          TEXT NOT NULL,
  sujet         TEXT NOT NULL,
  message       TEXT NOT NULL,
  piece_id      UUID REFERENCES fichiers(id) ON DELETE SET NULL,
  statut        TEXT NOT NULL DEFAULT 'En attente',
  reponse       TEXT,
  traitee_par   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ================= CANTINE SCOLAIRE =================
-- Inscription faite par le parent, en un appui : acceptée tout de suite
CREATE TABLE IF NOT EXISTS cantine_inscriptions (
  id          SERIAL PRIMARY KEY,
  eleve_id    INTEGER NOT NULL UNIQUE REFERENCES eleves(id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- parent qui a inscrit l'enfant
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Menu de la semaine : une seule photo (ou un PDF), envoyée aux parents des enfants inscrits ;
-- un nouveau menu remplace l'ancien
CREATE TABLE IF NOT EXISTS cantine_semaines (
  photo_id   UUID PRIMARY KEY REFERENCES fichiers(id),
  cree_par   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "pour" = un rôle ('admin', 'parent') ou l'id d'un utilisateur
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  pour       TEXT NOT NULL,
  type       TEXT NOT NULL,
  texte      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_pour ON notifications(pour);
CREATE TABLE IF NOT EXISTS notifications_lues (
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lu_at           TIMESTAMPTZ NOT NULL DEFAULT now(),   -- lue depuis plus de 3 jours → effacée
  PRIMARY KEY (notification_id, user_id)
);

-- Notifications dans la barre du téléphone : Web Push et Firebase
CREATE TABLE IF NOT EXISTS push_abonnements (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('web', 'fcm')),
  cle        TEXT NOT NULL UNIQUE,                     -- adresse Web Push, ou jeton Firebase
  donnees    JSONB,                                    -- abonnement Web Push complet (clés de chiffrement)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_abonnements(user_id);

-- Réglages simples (clé → valeur JSON) : clés des notifications Web Push…
CREATE TABLE IF NOT EXISTS parametres (
  cle    TEXT PRIMARY KEY,
  valeur JSONB NOT NULL
);

-- ================= MISE À JOUR DES ANCIENNES BASES =================
-- Plus d'espace Direction : ses comptes deviennent des comptes Administration (même email, même mot de passe)
UPDATE users SET role = 'admin' WHERE role = 'direction';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'parent'));
DELETE FROM notifications WHERE pour = 'direction';
ALTER TABLE reclamations DROP COLUMN IF EXISTS destinataires;
DROP TABLE IF EXISTS reunions;
-- Plus de WhatsApp : file d'envoi, session et réglages supprimés
DROP TABLE IF EXISTS wa_messages, wa_auth;
ALTER TABLE absences DROP COLUMN IF EXISTS parents_prevenus;
DELETE FROM parametres WHERE cle LIKE 'wa\_%';
-- Cantine : plus de validation par l'administration, de règlement ni de « NB » ; plus de menu jour par jour.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cantine_inscriptions' AND column_name = 'statut') THEN
    DELETE FROM cantine_inscriptions WHERE statut = 'Refusée';
  END IF;
END $$;
ALTER TABLE cantine_inscriptions DROP COLUMN IF EXISTS allergenes, DROP COLUMN IF EXISTS allergies,
  DROP COLUMN IF EXISTS non_manges, DROP COLUMN IF EXISTS remarques, DROP COLUMN IF EXISTS statut,
  DROP COLUMN IF EXISTS reponse, DROP COLUMN IF EXISTS traitee_par, DROP COLUMN IF EXISTS nb, DROP COLUMN IF EXISTS accepte_at;
DROP TABLE IF EXISTS cantine_menus;
-- Menu de la semaine : un seul menu (le dernier envoyé) ; plus de colonne « semaine »
DELETE FROM cantine_semaines WHERE created_at < (SELECT max(created_at) FROM cantine_semaines);
ALTER TABLE cantine_semaines DROP COLUMN IF EXISTS semaine;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'cantine_semaines'::regclass AND contype = 'p') THEN
    ALTER TABLE cantine_semaines ADD PRIMARY KEY (photo_id);
  END IF;
END $$;
-- Cantine : plus de suivi des repas (photo de l'assiette, a mangé / un peu / rien)
DROP TABLE IF EXISTS cantine_repas;
-- Emploi du temps : plus de grille (jour, créneau, enseignant), seulement une photo par classe (table emplois)
DROP TABLE IF EXISTS seances;
-- Plus d'enseignants
DROP TABLE IF EXISTS enseignants;
-- Classes : plus de niveaux (Petite, Moyenne, Grande section). Une seule fois : les 3 classes préparatoires
-- remplacent les anciennes classes vides (une classe qui a encore des élèves est gardée)
ALTER TABLE classes DROP COLUMN IF EXISTS niveau;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM parametres WHERE cle = 'classes_preparatoires') THEN
    INSERT INTO classes (nom) VALUES ('قسم تحضيري ياسمين'), ('قسم تحضيري فل'), ('قسم تحضيري أقحوان') ON CONFLICT DO NOTHING;
    DELETE FROM classes c WHERE nom NOT IN ('قسم تحضيري ياسمين', 'قسم تحضيري فل', 'قسم تحضيري أقحوان')
      AND NOT EXISTS (SELECT 1 FROM eleves e WHERE e.classe = c.nom);
    INSERT INTO parametres (cle, valeur) VALUES ('classes_preparatoires', 'true');
  END IF;
END $$;
-- Une seule fois : élèves, appels, cours et emplois du temps des anciennes classes déplacés dans les
-- classes préparatoires (Grande section A → ياسمين, Moyenne section A → فل, Petite section A → أقحوان),
-- puis les anciennes classes supprimées
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM parametres WHERE cle = 'anciennes_sections_deplacees') THEN
    CREATE TEMP TABLE deplacement (ancienne TEXT, nouvelle TEXT) ON COMMIT DROP;
    INSERT INTO deplacement VALUES ('Grande section A', 'قسم تحضيري ياسمين'), ('Moyenne section A', 'قسم تحضيري فل'),
      ('Petite section A', 'قسم تحضيري أقحوان');
    UPDATE eleves e SET classe = d.nouvelle FROM deplacement d WHERE e.classe = d.ancienne;
    UPDATE absences a SET classe = d.nouvelle FROM deplacement d WHERE a.classe = d.ancienne;
    UPDATE publications p SET classe = d.nouvelle FROM deplacement d WHERE p.classe = d.ancienne;
    -- Emploi du temps : gardé seulement si la nouvelle classe n'en a pas encore
    UPDATE emplois em SET classe = d.nouvelle FROM deplacement d
      WHERE em.classe = d.ancienne AND NOT EXISTS (SELECT 1 FROM emplois x WHERE x.classe = d.nouvelle);
    DELETE FROM classes WHERE nom IN (SELECT ancienne FROM deplacement);
    INSERT INTO parametres (cle, valeur) VALUES ('anciennes_sections_deplacees', 'true');
  END IF;
END $$;
-- Notifications lues : date de lecture (effacées 3 jours après ; les anciennes lectures comptent à partir d'aujourd'hui)
ALTER TABLE notifications_lues ADD COLUMN IF NOT EXISTS lu_at TIMESTAMPTZ NOT NULL DEFAULT now();
