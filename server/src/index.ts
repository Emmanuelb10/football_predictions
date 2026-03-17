import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import logger from './config/logger';
import routes from './routes';
import { startCronJobs } from './cron';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// API routes
app.use('/api', routes);

// Serve client in production
if (env.NODE_ENV === 'production') {
  const path = require('path');
  app.use(express.static(path.join(__dirname, '../../client/dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
  });
}

app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT} (${env.NODE_ENV})`);
  startCronJobs();
});

export default app;
