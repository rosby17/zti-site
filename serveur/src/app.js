// Assemble le serveur : API publique (/v1), API du tableau de bord (/v1/admin), fichiers du tableau de bord (/admin).
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { bodyLimit } from 'hono/body-limit';
import { publique } from './routes/public.js';
import { admin } from './routes/admin.js';
import { membres } from './routes/membres.js';
import { entetesSecurite, Occupe } from './securite.js';

export const app = new Hono();

// corps limité à 64 Ko partout, sauf l'envoi d'un logiciel du catalogue (300 Mo, réservé aux administrateurs)
const trop = c => c.json({ erreur: 'Requête trop volumineuse.' }, 413);
app.use('*', async (c, next) => /^\/v1\/admin\/produits\/[^/]+\/fichier$/.test(c.req.path) ? bodyLimit({ maxSize: 310 * 1024 * 1024, onError: trop })(c, next) : bodyLimit({ maxSize: 64 * 1024, onError: trop })(c, next));

app.use('/v1/*', async (c, next) => { await next(); entetesSecurite(c, false); });
app.route('/v1/admin', admin);
app.route('/v1/membres', membres);
app.route('/v1', publique);

// tableau de bord : fichiers fixes, avec une politique de sécurité stricte (aucun script extérieur)
app.use('/admin/*', async (c, next) => { await next(); entetesSecurite(c, true); });
app.get('/admin', c => c.redirect('/admin/', 301));
app.use('/admin/*', serveStatic({ root: './admin', rewriteRequestPath: p => p.replace(/^\/admin/, '') || '/' }));
// espace membre (ambassadeurs) : même politique de sécurité que le tableau de bord
app.use('/espace/*', async (c, next) => { await next(); entetesSecurite(c, true); });
app.get('/espace', c => c.redirect('/espace/', 301));
app.use('/espace/*', serveStatic({ root: './espace', rewriteRequestPath: p => p.replace(/^\/espace/, '') || '/' }));
app.get('/', c => c.redirect('/espace/', 302));

app.notFound(c => c.json({ erreur: 'Introuvable.' }, 404));
app.onError((e, c) => {
  if (e instanceof Occupe) return c.json({ erreur: e.message }, 503);
  console.error('Erreur :', e.code || '', e.message); // jamais e.detail (il peut contenir un e-mail)
  return c.json({ erreur: 'Erreur du serveur. Réessayez dans un instant.' }, 500);
});
