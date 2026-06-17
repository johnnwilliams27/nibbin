export type SpeciesName = 'Sprout' | 'Wisp' | 'Capling' | 'Longear' | 'Puff' | 'Glim' | 'Keeper';

export type Stage = 'egg' | 'student' | 'senior' | 'grad';

export type Accessory = 'none' | 'glasses' | 'bow' | 'pencil' | 'broom' | 'quill' | 'coin';

export type Marking = 'none' | 'spots' | 'stripe' | 'star';

export interface Palette {
  n: string;
  c: string;
}

export interface BuildOptions {
  species: SpeciesName;
  stage?: Stage;
  color?: string;
  acc?: Accessory;
  mark?: Marking;
  size?: number;
}

export interface FaceAnchors {
  exL: number;
  exR: number;
  ey: number;
  er: number;
}

export interface AccessoryAnchors {
  neckX: number;
  neckY: number;
  neckW: number;
  beltX: number;
  beltY: number;
  sideX: number;
  sideY: number;
  handX: number;
  handY: number;
  headX: number;
  headY: number;
  strapX: number;
  strapY: number;
}

export interface Anchors {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  capX: number;
  capY: number;
  capRot?: number;
  capS?: number;
  acc?: AccessoryAnchors;
  face?: FaceAnchors;
}

export interface BodyParts {
  pre: string;
  body: string;
  post: string;
  face: FaceAnchors;
  anchors: Anchors;
  floaty?: boolean;
}

export interface EggParts {
  art: string;
  floaty?: boolean;
}

export interface SpeciesDef {
  trait: string;
  tilt: number;
  canonical?: boolean;
  egg(color: string): EggParts | BodyParts;
  body(stage?: Stage, color?: string): BodyParts;
}
