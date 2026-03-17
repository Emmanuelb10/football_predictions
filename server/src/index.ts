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

// Serve client build (frontend)
import path from 'path';
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(env.PORT, '0.0.0.0', () => {
  logger.info(`Server running on 0.0.0.0:${env.PORT} (${env.NODE_ENV})`);
  startCronJobs();
});

export default app;
