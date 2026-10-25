const express = require('express');
const QRCode = require('qrcode');
const { configuredOrigin, joinUrl } = require('../lib/join-url');

function createChampionshipRouter(service, requireOrganizer, { publicBaseUrl } = {}) {
  const router = express.Router();
  const origin = configuredOrigin(publicBaseUrl);
  const decorate = (state, req) =>
    state.initialized
      ? { ...state, join_url: joinUrl(state.championship.id, req.socket.localPort, origin) }
      : state;
  const action =
    (handler, success = 200) =>
    async (req, res) => {
      try {
        const result = await handler(req);
        res
          .status(success)
          .json(
            result.snapshot ? { ...result, snapshot: decorate(result.snapshot, req) } : decorate(result, req)
          );
      } catch (error) {
        const status = error.status || 500;
        if (status === 500) console.error('Championship operation failed:', error.message);
        res
          .status(status)
          .json({
            error: status === 500 ? 'Could not save the tournament. Please try again.' : error.message,
            ...(status === 409 ? { snapshot: decorate(await service.current(), req) } : {})
          });
      }
    };
  router.get(
    '/current',
    action(() => service.current())
  );
  router.get('/current/qr.svg', async (req, res, next) => {
    try {
      const state = await service.current();
      const url = joinUrl(state.championship?.id, req.socket.localPort, origin);
      if (!url) return res.status(404).json({ error: 'Set up a reachable join address first.' });
      res.type('svg').send(await QRCode.toString(url, { type: 'svg', margin: 2, width: 240 }));
    } catch (error) {
      next(error);
    }
  });
  router.post(
    '/',
    requireOrganizer,
    action((req) => service.create(req.body), 201)
  );
  router.post(
    '/:id/players',
    action((req) => service.register(req.params.id, req.body))
  );
  router.post(
    '/:id/start',
    requireOrganizer,
    action((req) => service.start(req.params.id, req.body))
  );
  router.put(
    '/:id/rounds/:roundId/result',
    requireOrganizer,
    action((req) => service.saveResult(req.params.id, req.params.roundId, req.body))
  );
  router.post(
    '/:id/advance',
    requireOrganizer,
    action((req) => service.advance(req.params.id, req.body))
  );
  router.put(
    '/:id/pause',
    requireOrganizer,
    action((req) => service.pause(req.params.id, req.body))
  );
  router.post(
    '/:id/complete',
    requireOrganizer,
    action((req) => service.complete(req.params.id, req.body))
  );
  return router;
}

module.exports = createChampionshipRouter;
