export type Color = 'w' | 'b';

/** Puntuación desde el punto de vista de las blancas */
export interface Score {
  kind: 'cp' | 'mate';
  /** centipeones o jugadas hasta mate (signo + = ventaja blanca) */
  v: number;
  /** solo para posiciones de jaque mate ya en el tablero */
  mated?: Color;
}

export interface EngineLine {
  depth: number;
  /** puntuación desde el punto de vista del bando que mueve */
  kind: 'cp' | 'mate';
  v: number;
  pv: string[]; // UCI
}

export interface PositionEval {
  fen: string;
  white: Score;
  lines: EngineLine[];
  terminal?: 'checkmate' | 'draw';
  depth: number;
}

export type Classification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'forced';

export interface PlyMove {
  ply: number; // 1..N
  san: string;
  uci: string;
  from: string;
  to: string;
  color: Color;
  piece: string;
  captured?: string;
  promotion?: string;
  fenBefore: string;
  fenAfter: string;
  legalCount: number;
  isBook: boolean;
  opening?: string;
}

export interface MoveAnalysis {
  classification: Classification;
  winBefore: number; // punto de vista del que mueve
  winAfter: number;
  loss: number;
  accuracy: number;
  bestUci?: string;
  bestSan?: string;
  bestLineSan: string[];
  afterLineSan: string[];
  isBest: boolean;
  sacrifice: boolean;
  /** material neto (en peones) que el rival puede ganar tras la jugada */
  sacrificeAmount: number;
  /** sacrificio de peón(es) / gambito */
  pawnSacrifice: boolean;
  pawnSacAmount: number;
}

export interface ParsedGame {
  headers: Record<string, string>;
  startFen: string;
  moves: PlyMove[];
  standardStart: boolean;
  opening?: string;
}
