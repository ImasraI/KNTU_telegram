import {WorkerEntrypoint} from 'cloudflare:workers';
import worker,{connectPersonal,disconnectPersonal,personalHomework,personalStatus,unifyConnections} from './worker.js';
export default worker;
export class CatalogAdmin extends WorkerEntrypoint {
  async unify(){return await unifyConnections(this.env);}
  async homework(id,refs){return await personalHomework(this.env,id,refs);}
  // These receive only a Telegram id that the shared gateway vouched for after the
  // bot endpoint verified the caller's init data. No request body names a user.
  async status(id){return await personalStatus(this.env,id);}
  async connect(id,input){return await connectPersonal(this.env,id,input??{});}
  async disconnect(id){return await disconnectPersonal(this.env,id);}
}
