// Tests sans base de données : contenu des e-mails écrits avec les saisies d'un visiteur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remplir } from '../src/notifier.js';
import { motSur, sansLien } from '../src/securite.js';

test('e-mails : un visiteur ne peut pas glisser un lien ou une phrase dans un accusé signé ZTi', () => {
  const t = remplir('Bonjour {prenom}, merci {organisation}.', { nom: 'Jean https://arnaque.example/gain', organisation: 'Gagnez <b>1000</b> www.faux.cm' });
  assert.ok(!/https?:|www\.|<|\.example/.test(t), t);
  assert.equal(remplir('Bonjour {prenom}', { nom: 'Marie Ngono' }), 'Bonjour Ngono');
  assert.equal(motSur("Jean-Pierre O'Neil\nhttp://x"), "Jean-Pierre O'Neilhttpx");
  assert.ok(sansLien('Jean https://x.cm') && sansLien('a\nb') && !sansLien('Complexe scolaire Les Lauriers'));
});
