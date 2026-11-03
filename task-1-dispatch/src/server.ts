// @rev kc-31
import { createDispatchServer } from './app.ts';

const port = Number(process.env.PORT ?? 3001);
const server = createDispatchServer();

server.listen(port, () => {
  console.log(`dispatch: http://localhost:${port}`);
});
