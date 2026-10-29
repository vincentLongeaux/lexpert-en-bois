import type * as Party from "partykit/server";

export default class Server implements Party.Server {
  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    console.log(`Nouvelle connexion: ${conn.id}`);
    conn.send("Bienvenue sur le serveur de L'Expert en Bois !");
  }

  onMessage(message: string, sender: Party.Connection) {
    console.log(`Message reçu de ${sender.id}: ${message}`);
    this.room.broadcast(message);
  }
}
