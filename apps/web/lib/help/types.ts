export interface HelpArticle { id: string; q: string; body: string; keywords?: string[]; }
export interface HelpSection { id: string; title: string; intro?: string; articles: HelpArticle[]; }
export type HelpContent = HelpSection[];
