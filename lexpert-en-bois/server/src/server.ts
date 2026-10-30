import type * as Party from "partykit/server";

// ============================================================================
// TYPES & DISCRIMINATED UNIONS
// ============================================================================

export type Phase = 'LOBBY' | 'QUESTION_PHASE' | 'ANSWER_PHASE' | 'VOTING_PHASE' | 'RESULTS_PHASE';

export interface Player {
  id: string;
  pseudo: string;
  score: number;
  answer?: string;
  vote?: string;
}

export interface GameState {
  phase: Phase;
  players: Record<string, Player>;
  currentQuestionIndex: number;
}

export type ClientToServerMessage =
  | { type: 'JOIN'; payload: { pseudo: string } }
  | { type: 'START_GAME' }
  | { type: 'SUBMIT_ANSWER'; payload: { answer: string } }
  | { type: 'SUBMIT_VOTE'; payload: { voteId: string } } // voteId est l'ID du joueur bluffeur, ou 'REAL'
  | { type: 'NEXT_ROUND' };

export type ServerToClientMessage =
  | { type: 'STATE_UPDATE'; payload: { state: GameState } }
  | { type: 'QUESTION_UPDATE'; payload: { question: string } }
  | { type: 'VOTING_CHOICES'; payload: { choices: { id: string; text: string }[] } }
  | { type: 'ERROR'; payload: { message: string } };

// ============================================================================
// MOCK DATA
// ============================================================================

const MOCK_QUESTIONS = [
  { question: "Quelle est la particularité du bois de gaïac ?", realAnswer: "C'est l'un des seuls bois qui coule dans l'eau" },
  { question: "En quelle année a été inventée la scie circulaire ?", realAnswer: "1777" },
  { question: "Quel arbre produit le bois le plus tendre au monde ?", realAnswer: "Le balsa" }
];

// ============================================================================
// PARTYKIT SERVER
// ============================================================================

export default class GameServer implements Party.Server {
  private state: GameState = {
    phase: 'LOBBY',
    players: {},
    currentQuestionIndex: 0,
  };

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    this.sendTo(conn, { type: 'STATE_UPDATE', payload: { state: this.state } });
  }

  onClose(conn: Party.Connection) {
    // Résilience : Si le joueur quitte dans le lobby, on le retire.
    // S'il quitte en jeu, on pourrait le garder en mémoire pour reconnexion, 
    // ou implémenter une logique d'abandon. Ici on le retire s'il est en LOBBY.
    if (this.state.phase === 'LOBBY' && this.state.players[conn.id]) {
      delete this.state.players[conn.id];
      this.broadcastState();
    }
  }

  onMessage(messageString: string, sender: Party.Connection) {
    let msg: ClientToServerMessage;
    try {
      msg = JSON.parse(messageString) as ClientToServerMessage;
    } catch (e) {
      return;
    }

    switch (msg.type) {
      case 'JOIN': {
        if (this.state.phase !== 'LOBBY') {
          return this.sendTo(sender, { type: 'ERROR', payload: { message: "Partie déjà commencée" } });
        }
        this.state.players[sender.id] = {
          id: sender.id,
          pseudo: msg.payload.pseudo,
          score: 0
        };
        this.broadcastState();
        break;
      }

      case 'START_GAME': {
        if (this.state.phase === 'LOBBY' && Object.keys(this.state.players).length > 0) {
          this.startRound();
        }
        break;
      }

      case 'SUBMIT_ANSWER': {
        if (this.state.phase !== 'ANSWER_PHASE') return;
        const player = this.state.players[sender.id];
        if (player) {
          player.answer = msg.payload.answer;
          this.checkAllAnswersSubmitted();
        }
        break;
      }

      case 'SUBMIT_VOTE': {
        if (this.state.phase !== 'VOTING_PHASE') return;
        const player = this.state.players[sender.id];
        
        // Sécurité : Impossible de voter pour sa propre réponse
        if (player && msg.payload.voteId !== sender.id) {
          player.vote = msg.payload.voteId;
          this.checkAllVotesSubmitted();
        }
        break;
      }

      case 'NEXT_ROUND': {
        if (this.state.phase === 'RESULTS_PHASE') {
          this.state.currentQuestionIndex = (this.state.currentQuestionIndex + 1) % MOCK_QUESTIONS.length;
          this.startRound();
        }
        break;
      }
    }
  }

  // ============================================================================
  // STATE MACHINE LOGIC
  // ============================================================================

  private startRound() {
    // Reset des réponses et votes pour le nouveau round
    for (const player of Object.values(this.state.players)) {
      player.answer = undefined;
      player.vote = undefined;
    }
    
    this.state.phase = 'QUESTION_PHASE';
    this.broadcastState();

    const q = MOCK_QUESTIONS[this.state.currentQuestionIndex];
    this.broadcast({ type: 'QUESTION_UPDATE', payload: { question: q.question } });
    
    // Transition immédiate vers l'attente de réponses
    this.state.phase = 'ANSWER_PHASE';
    this.broadcastState();
  }

  private checkAllAnswersSubmitted() {
    const players = Object.values(this.state.players);
    const allAnswered = players.every(p => p.answer !== undefined && p.answer.trim() !== "");
    
    if (allAnswered) {
      this.triggerVotingPhase();
    } else {
      this.broadcastState(); // Mise à jour pour afficher qui a déjà répondu
    }
  }

  // Génération et mélange des choix avant le broadcast de la phase de vote
  private triggerVotingPhase() {
    this.state.phase = 'VOTING_PHASE';
    this.broadcastState();

    const currentQ = MOCK_QUESTIONS[this.state.currentQuestionIndex];
    
    // On rassemble les fausses réponses des joueurs et la vraie réponse
    const choices = Object.values(this.state.players).map(p => ({
      id: p.id,
      text: p.answer!
    }));
    choices.push({ id: 'REAL', text: currentQ.realAnswer });

    // Algorithme de Fisher-Yates pour mélanger les choix
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [choices[i], choices[j]] = [choices[j], choices[i]];
    }

    this.broadcast({ type: 'VOTING_CHOICES', payload: { choices } });
  }

  private checkAllVotesSubmitted() {
    const ObjectPlayers = Object.values(this.state.players);
    const allVoted = ObjectPlayers.every(p => p.vote !== undefined);

    if (allVoted) {
      this.calculateResults();
    } else {
      this.broadcastState();
    }
  }

  // Calcul des scores finaux pour ce round
  private calculateResults() {
    this.state.phase = 'RESULTS_PHASE';
    
    const POINTS_FOR_TRUTH = 2; // X points si on trouve la vraie réponse
    const POINTS_PER_BLUFF = 1; // Y points par joueur piégé

    for (const player of Object.values(this.state.players)) {
      if (player.vote === 'REAL') {
        player.score += POINTS_FOR_TRUTH;
      } else if (player.vote) {
        // On donne le point de bluff au propriétaire de la fausse réponse
        const dupedPlayerTarget = this.state.players[player.vote];
        if (dupedPlayerTarget) {
          dupedPlayerTarget.score += POINTS_PER_BLUFF;
        }
      }
    }

    this.broadcastState();
  }

  // ============================================================================
  // UTILS
  // ============================================================================

  private broadcast(message: ServerToClientMessage) {
    this.room.broadcast(JSON.stringify(message));
  }

  private broadcastState() {
    this.broadcast({ type: 'STATE_UPDATE', payload: { state: this.state } });
  }

  private sendTo(conn: Party.Connection, message: ServerToClientMessage) {
    conn.send(JSON.stringify(message));
  }
}
