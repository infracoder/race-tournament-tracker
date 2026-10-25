const express = require('express');

function createChampionshipRouter(service, requireOrganizer) {
  const router = express.Router();
  const action = (handler, success = 200) => async (req, res) => {
    try { res.status(success).json(await handler(req)); }
    catch (error) {
      const status = error.status || 500;
      if (status === 500) console.error('Championship operation failed:', error);
      res.status(status).json({ error: status === 500 ? 'Could not save the tournament. Please try again.' : error.message,
        ...(status === 409 ? { snapshot: await service.current() } : {}) });
    }
  };
  router.get('/current', action(() => service.current()));
  router.post('/', requireOrganizer, action(req => service.create(req.body), 201));
  router.post('/:id/players', action(req => service.register(req.params.id, req.body)));
  router.post('/:id/start', requireOrganizer, action(req => service.start(req.params.id, req.body)));
  router.put('/:id/rounds/:roundId/result', requireOrganizer, action(req => service.saveResult(req.params.id, req.params.roundId, req.body)));
  router.post('/:id/advance', requireOrganizer, action(req => service.advance(req.params.id, req.body)));
  router.put('/:id/pause', requireOrganizer, action(req => service.pause(req.params.id, req.body)));
  router.post('/:id/complete', requireOrganizer, action(req => service.complete(req.params.id, req.body)));
  return router;
}

module.exports = createChampionshipRouter;
