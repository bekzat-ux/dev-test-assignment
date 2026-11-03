// @rev kc-31
import { createBookingServer } from './app.ts';

const port = Number(process.env.PORT ?? 3002);
const server = createBookingServer();

server.listen(port, () => {
  console.log(`booking: http://localhost:${port}`);
});
