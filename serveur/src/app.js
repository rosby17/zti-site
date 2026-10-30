// Assemble le serveur : API publique (/v1), API du tableau de bord (/v1/admin), fichiers du tableau de bord (/admin).
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { bodyLimit } from 'hono/body-limit';
import { publique } from './routes/public.js';
import { admin } from './routes/admin.js';
import { entetesSecurite } from './securite.js';

export const app = new Hono();

app.use('*', bodyLimit({ maxSize: 64 * 1024, onError: c => c.json({ erreur: 'Requête trop volumineuse.' }, 413) }));

app.route('/v1/admin', admin);
app.route('/v1', publique);

// tableau de bord : fichiers fixes, avec une politique de sécurité stricte (aucun script extérieur)
app.use('/admin/*', async (c, next) => { await next(); entetesSecurite(c, true); });
app.get('/admin', c => c.redirect('/admin/', 301));
app.use('/admin/*', serveStatic({ root: './admin', rewriteRequestPath: p => p.replace(/^\/admin/, '') || '/' }));
app.get('/', c => c.redirect('/admin/', 302));

app.notFound(c => c.json({ erreur: 'Introuvable.' }, 404));
app.onError((e, c) => {
  console.error(e);
  return c.json({ erreur: 'Erreur du serveur. Réessayez dans un instant.' }, 500);
});
