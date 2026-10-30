import { useState } from "react";
import usePartySocket from "partysocket/react";

export default function App() {
  const [messages, setMessages] = useState<string[]>([]);

  const socket = usePartySocket({
    host: "localhost:1999",
    room: "salle-de-jeu",
    onMessage(event) {
      setMessages((prev) => [...prev, event.data]);
    },
  });

  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      <h1>L'Expert en Bois 🪵</h1>
      
      <button 
        onClick={() => socket.send("Nouveau joueur prêt !")}
        style={{ padding: "10px", fontSize: "16px", cursor: "pointer" }}
      >
        Tester la connexion au serveur
      </button>

      <div style={{ marginTop: "20px" }}>
        <h2>Messages du serveur :</h2>
        <ul>
          {messages.map((msg, i) => (
            <li key={i}>{msg}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}