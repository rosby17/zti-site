-- Réglages modifiables depuis le back-office : modèles d'e-mails et destinataires des alertes.
create table reglages (
  cle text primary key,
  valeur jsonb not null,
  modifie_le timestamptz not null default now(),
  modifie_par uuid references equipe (id) on delete set null
);

insert into reglages (cle, valeur) values
  ('alertes', '{"destinataires": ["zeltuminitiative@gmail.com"], "demandes": true, "avis": true}'),
  ('accuse_demande', jsonb_build_object(
    'actif', true,
    'sujet', 'ZTi a bien reçu votre demande',
    'texte', E'Bonjour {prenom},\n\nMerci pour votre demande : elle est bien enregistrée.\n\nZTi étudie les informations que vous avez données et vous recontacte sous 48 heures, au moment que vous avez choisi, par téléphone ou WhatsApp.\n\nPour aller plus vite, vous pouvez aussi nous écrire sur WhatsApp au +237 699 324 689.\n\nÀ très vite,\nL''équipe ZTi\nVotre partenaire de confiance, depuis 2008'
  )),
  ('signature', '{"texte": "L''équipe ZTi — Zèl Tum Initiative SARL, Yaoundé\nVotre partenaire de confiance, depuis 2008"}');
