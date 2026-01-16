// Shared types for the PhDApply system

// ============ User Input Types ============

export interface UserInput {
  professorName: string;
  university: string;
  language: 'english' | 'german' | 'french' | 'other';
  customLanguage?: string;
  fundingStatus: 'fully_funded' | 'partially_funded' | 'self_funded' | 'seeking_funding';
  researchInterests: string;
  preferredStart: string;
  cvFile?: File;
  cvText?: string;
  researchStatement?: string;
  additionalNotes?: string;
  postingContent?: string;
}

// ============ CV Parser Output ============

export interface Education {
  degree: string;
  institution: string;
  year: number;
  gpa?: string;
  thesis?: string;
}

export interface Experience {
  title: string;
  organization: string;
  dates: string;
  description: string;
  skills: string[];
}

export interface Publication {
  title: string;
  venue: string;
  year: number;
  role: 'first_author' | 'co_author';
  url?: string;
}

export interface UserProfile {
  name: string;
  education: Education[];
  experience: Experience[];
  publications: Publication[];
  skills: string[];
  summary: string;
}

// ============ Professor Research Output ============

export interface Paper {
  title: string;
  year: number;
  abstract: string;
  url: string;
  venue?: string;
  authors?: string[];
  fullText?: string; // Downloaded paper content
  pdfUrl?: string; // Direct PDF link if available
}

export interface ProfessorProfile {
  name: string;
  title: string;
  university: string;
  department: string;
  email: string | null;
  emailSource: string | null;
  researchInterests: string[];
  recentPapers: Paper[];
  currentProjects: string[];
  labInfo: string;
  labUrl: string | null;
  openPositions: string | null;
  sources: string[];
}

// ============ Fit Analysis Output ============

export interface FitAnalysis {
  overallFit: 'high' | 'medium' | 'low';
  keyOverlaps: string[];
  gaps: string[];
  bestPaperToReference: Paper;
  suggestedAngle: string;
}

// ============ Paper Selection Types ============

export interface PaperCandidate {
  title: string;
  year: number;
  abstract?: string;
  url: string;
  pdfUrl?: string;
  citationCount: number;
  venue?: string;
  relevanceScore?: number;
}

export interface PaperSelectionDecision {
  papersToDownload: Array<{
    title: string;
    pdfUrl: string;
    reason: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  papersToSkip: Array<{
    title: string;
    reason: string;
  }>;
  shouldSearchMore: boolean;
  searchSuggestions?: string[];
  reasoning: string;
}

export interface PaperContext {
  availablePapers: PaperCandidate[];
  downloadedContent: Map<string, string>;
  selectionHistory: PaperSelectionDecision[];
  totalDownloaded: number;
  maxPapers: number;
}

// ============ Additional Paper Search Types ============

export interface AdditionalPaperSuggestion {
  title: string;
  keywords?: string[];
  reason: string;
}

export interface AdditionalPaperResult {
  suggestion: AdditionalPaperSuggestion;
  success: boolean;
  paper?: {
    title: string;
    year: number;
    abstract?: string;
    pdfUrl?: string;
  };
  error?: string;
  contentExtracted?: boolean;
}

export interface AdditionalPapersDecision {
  suggestedPapers: AdditionalPaperSuggestion[];
  reasoning: string;
  shouldSuggestMore: boolean;
}

// ============ Email Output ============

export interface EmailOutput {
  subjectOptions: string[];
  body: string;
  wordCount: number;
  referencedPaper: { title: string; url: string };
  effectivenessNote: string;
}

// ============ CV Recommendations Output ============

export interface CVUpdate {
  section: string;
  currentText: string;
  suggestedText: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

export interface CVKeep {
  section: string;
  reason: string;
}

export interface CVRecommendations {
  updates: CVUpdate[];
  keepAsIs: CVKeep[];
  removeOrDeemphasize: { section: string; reason: string }[];
  formatSuggestions: string[];
}

// ============ Motivation Letter Output ============

export interface MotivationLetterOutput {
  letter: string;
  wordCount: number;
  sections: { name: string; content: string }[];
}

// ============ Research Proposal Output ============

export interface ResearchProposalOutput {
  title: string;
  abstract: string;
  sections: { heading: string; content: string }[];
  references: string[];
  wordCount: number;
}

// ============ Shared Context ============

export interface SharedContext {
  input: UserInput;
  userProfile?: UserProfile;
  professorProfile?: ProfessorProfile;
  fitAnalysis?: FitAnalysis;
  email?: EmailOutput;
  cvRecommendations?: CVRecommendations;
  motivationLetter?: MotivationLetterOutput;
  researchProposal?: ResearchProposalOutput;
}

// ============ Agent Status ============

export interface AgentStatus {
  step: number;
  name: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  currentAction: string;
  progress: number;
  timeElapsed: number;
  output?: unknown;
  error?: string;
}

export interface PipelineStatus {
  agents: AgentStatus[];
  currentAgent: string;
  overallProgress: number;
  startTime: Date;
}

// ============ Final Output ============

export interface GenerationResult {
  success: boolean;
  email?: EmailOutput;
  cvRecommendations?: CVRecommendations;
  motivationLetter?: MotivationLetterOutput;
  researchProposal?: ResearchProposalOutput;
  professorProfile?: ProfessorProfile;
  fitAnalysis?: FitAnalysis;
  error?: string;
}
