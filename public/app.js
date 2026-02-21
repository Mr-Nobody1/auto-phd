// PhDApply Frontend Application

// ============ State ============
let currentResults = null;
let startTime = null;
let timerInterval = null;

// ============ DOM Elements ============
const formSection = document.getElementById('form-section');
const progressSection = document.getElementById('progress-section');
const resultsSection = document.getElementById('results-section');
const applicationForm = document.getElementById('application-form');
const agentList = document.getElementById('agent-list');
const currentAgentName = document.getElementById('current-agent-name');
const currentAgentAction = document.getElementById('current-agent-action');
const timeElapsed = document.getElementById('time-elapsed');

// ============ Agent Definitions ============
const AGENTS = [
  { step: 1, name: 'CV Parser', icon: '📄' },
  { step: 2, name: 'Professor Researcher', icon: '🔍' },
  { step: 3, name: 'Paper Selector', icon: '📚' },
  { step: 4, name: 'Fit Analyzer', icon: '🎯' },
  { step: 5, name: 'Email Writer', icon: '✉️' },
  { step: 6, name: 'CV Recommender', icon: '📝' },
  { step: 7, name: 'Motivation Letter Writer', icon: '💭' },
  { step: 8, name: 'Research Proposal Writer', icon: '📋' },
];

// ============ Initialization ============
document.addEventListener('DOMContentLoaded', () => {
  setupFormHandlers();
  setupTabHandlers();
  setupFileUpload();
  setupImageUpload();
});

// ============ Form Handlers ============
function setupFormHandlers() {
  applicationForm.addEventListener('submit', handleSubmit);

  // Language select handler
  const languageSelect = document.getElementById('language');
  const customLanguageGroup = document.getElementById('customLanguageGroup');

  languageSelect.addEventListener('change', (e) => {
    customLanguageGroup.style.display = e.target.value === 'other' ? 'block' : 'none';
  });
}

function setupFileUpload() {
  const cvFile = document.getElementById('cvFile');
  const cvUpload = document.getElementById('cvUpload');
  const cvFileName = document.getElementById('cvFileName');

  cvFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      cvFileName.textContent = file.name;
      cvUpload.classList.add('has-file');
    } else {
      cvFileName.textContent = 'Click to upload or drag & drop (PDF)';
      cvUpload.classList.remove('has-file');
    }
  });
}

function setupImageUpload() {
  const contextImage = document.getElementById('contextImage');
  const contextImageUpload = document.getElementById('contextImageUpload');
  const contextImageFileName = document.getElementById('contextImageFileName');

  if (!contextImage || !contextImageUpload || !contextImageFileName) {
    return;
  }

  contextImage.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      contextImageFileName.textContent = file.name;
      contextImageUpload.classList.add('has-file');
    } else {
      contextImageFileName.textContent = 'Upload optional screenshot/image context';
      contextImageUpload.classList.remove('has-file');
    }
  });
}

async function handleSubmit(e) {
  e.preventDefault();

  const formData = new FormData(applicationForm);
  const submitBtn = document.getElementById('submitBtn');

  // Validate
  if (!formData.get('professorName') || !formData.get('university')) {
    alert('Please fill in professor name and university');
    return;
  }

  if (!formData.get('cvFile')?.size) {
    alert('Please upload your CV');
    return;
  }

  // Disable submit button
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Processing...';

  // Switch to progress view
  showSection('progress');
  initializeAgentList();
  startTimer();

  try {
    // Make API request with SSE
    const response = await fetch('/api/generate', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Read SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEventType = '';

    console.log('📡 SSE Stream started');

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        console.log('📡 SSE Stream closed');
        // Process any remaining data in the buffer
        if (buffer.trim()) {
          console.log('📡 Processing final buffer chunk:', buffer);
          processBuffer(buffer);
        }
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      processLines(lines);
    }

    function processLines(lines) {
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        console.log('📡 SSE Line:', line);

        if (line.startsWith('event: ')) {
          currentEventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim();
          console.log(`📡 SSE Event [${currentEventType}] received, length: ${dataStr.length}`);
          
          try {
            const data = JSON.parse(dataStr);
            handleSSEEvent(currentEventType, data);
          } catch (err) {
            console.error('❌ Failed to parse SSE JSON data:', err);
            console.error('Data string that failed:', dataStr);
          }
          // Reset event type after processing data
          currentEventType = '';
        }
      }
    }

    function processBuffer(buf) {
      const lines = buf.split('\n');
      processLines(lines);
    }
  } catch (error) {
    console.error('❌ Generation error:', error);
    alert('An error occurred: ' + error.message);
    showSection('form');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span class="btn-icon">🚀</span><span class="btn-text">Generate Application Materials</span>';
    stopTimer();
  }
}

// ============ SSE Event Handlers ============
function handleSSEEvent(eventType, data) {
  switch (eventType) {
    case 'status':
      updateAgentStatus(data);
      break;
    case 'complete':
      handleComplete(data);
      break;
    case 'error':
      handleError(data);
      break;
  }
}

function updateAgentStatus(status) {
  const { step, name, status: agentStatus, currentAction } = status;

  // Update agent list item
  const agentItem = document.querySelector(`.agent-item[data-step="${step}"]`);
  if (agentItem) {
    agentItem.className = `agent-item ${agentStatus}`;

    const icon = agentItem.querySelector('.agent-status-icon');
    icon.className = `agent-status-icon ${agentStatus}`;
    icon.textContent = getStatusIcon(agentStatus);

    const action = agentItem.querySelector('.agent-action');
    action.textContent = currentAction;
  }

  // Update current agent box
  if (agentStatus === 'running') {
    currentAgentName.textContent = name;
    currentAgentAction.textContent = currentAction;
  }
}

function handleComplete(result) {
  console.log('✅ handleComplete called with result:', result);
  currentResults = result;
  stopTimer();

  if (result.success) {
    console.log('✅ Pipeline successful, switching to results view');
    showSection('results');
    renderResults(result);
    console.log('✅ Results rendered');
  } else {
    console.error('❌ Pipeline failed:', result.error);
    alert('Generation failed: ' + (result.error || 'Unknown error'));
    showSection('form');
  }
}

function handleError(data) {
  console.error('Pipeline error:', data);
  alert('An error occurred: ' + data.error);
  showSection('form');
}

// ============ Progress View ============
function initializeAgentList() {
  agentList.innerHTML = AGENTS.map(agent => `
    <div class="agent-item pending" data-step="${agent.step}">
      <div class="agent-status-icon pending">⏳</div>
      <div class="agent-info">
        <div class="agent-name">${agent.icon} ${agent.name}</div>
        <div class="agent-action">Waiting...</div>
      </div>
    </div>
  `).join('');

  currentAgentName.textContent = 'Initializing...';
  currentAgentAction.textContent = 'Starting pipeline...';
}

function getStatusIcon(status) {
  switch (status) {
    case 'pending': return '⏳';
    case 'running': return '🔄';
    case 'complete': return '✅';
    case 'error': return '❌';
    default: return '⏳';
  }
}

function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    timeElapsed.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// ============ Results View ============

// Helper to parse markdown content safely
function parseMarkdown(text) {
  if (!text) return '';
  try {
    // Use marked.js to parse markdown
    if (typeof marked !== 'undefined') {
      return marked.parse(text);
    }
    // Fallback: escape HTML and preserve newlines
    return escapeHtml(text).replace(/\n/g, '<br>');
  } catch (e) {
    console.error('Markdown parsing error:', e);
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
}

// Get raw text from element (for copy function)
function getRawText(elementId) {
  const element = document.getElementById(elementId);
  if (!element) return '';
  // Get the raw text from data attribute if available
  return element.dataset.rawText || element.textContent;
}

function renderResults(result) {
  // Email
  if (result.email) {
    renderEmail(result.email);
  }

  // CV Recommendations
  if (result.cvRecommendations) {
    renderCVRecommendations(result.cvRecommendations);
  }

  // Motivation Letter
  if (result.motivationLetter) {
    renderMotivationLetter(result.motivationLetter);
  }

  // Research Proposal
  if (result.researchProposal) {
    renderResearchProposal(result.researchProposal);
  }
}

function renderEmail(email) {
  // Subject lines
  const subjectLinesEl = document.getElementById('subject-lines');
  subjectLinesEl.innerHTML = email.subjectOptions.map((subject, i) => `
    <div class="subject-line" onclick="copyToClipboard(null, '${escapeHtml(subject)}')">
      <div class="subject-line-number">${i + 1}</div>
      <div class="subject-line-text">${escapeHtml(subject)}</div>
    </div>
  `).join('');

  // Email body with markdown support
  const emailBody = document.getElementById('email-body');
  emailBody.classList.add('markdown-content');
  emailBody.innerHTML = parseMarkdown(email.body);
  emailBody.dataset.rawText = email.body; // Store raw text for copying

  // Meta
  document.getElementById('email-word-count').textContent = `${email.wordCount} words`;
  document.getElementById('email-paper-ref').textContent = 
    `Referenced: "${email.referencedPaper?.title || 'N/A'}"`;
}

function renderCVRecommendations(cvRecs) {
  const updatesEl = document.getElementById('cv-updates');
  const keepsEl = document.getElementById('cv-keeps');

  // Updates
  updatesEl.innerHTML = cvRecs.updates.map(update => `
    <div class="cv-update ${update.priority}">
      <div class="cv-update-header">
        <span class="cv-update-section">${escapeHtml(update.section)}</span>
        <span class="cv-update-priority ${update.priority}">${update.priority}</span>
      </div>
      <div class="cv-update-current">
        <strong>Current:</strong><br>${escapeHtml(update.currentText)}
      </div>
      <div class="cv-update-suggested">
        <strong>Suggested:</strong><br>${escapeHtml(update.suggestedText)}
      </div>
      <div class="cv-update-reason">${escapeHtml(update.reason)}</div>
    </div>
  `).join('');

  // Keeps
  keepsEl.innerHTML = cvRecs.keepAsIs.map(keep => `
    <div class="cv-keep">
      <span class="cv-keep-icon">✅</span>
      <div>
        <strong>${escapeHtml(keep.section)}</strong>
        <p>${escapeHtml(keep.reason)}</p>
      </div>
    </div>
  `).join('');
}

function renderMotivationLetter(letter) {
  const letterEl = document.getElementById('motivation-letter');
  letterEl.classList.add('markdown-content');
  letterEl.innerHTML = parseMarkdown(letter.letter);
  letterEl.dataset.rawText = letter.letter; // Store raw text for copying
  document.getElementById('motivation-word-count').textContent = `${letter.wordCount} words`;
}

function renderResearchProposal(proposal) {
  document.getElementById('proposal-title').textContent = proposal.title || 'Research Proposal';

  const proposalEl = document.getElementById('research-proposal');
  proposalEl.classList.add('markdown-content');
  
  // Format proposal with markdown sections
  let content = '';
  if (proposal.abstract) {
    content += `## Abstract\n\n${proposal.abstract}\n\n`;
  }
  
  proposal.sections.forEach(section => {
    content += `## ${section.heading}\n\n${section.content}\n\n`;
  });

  if (proposal.references && proposal.references.length > 0) {
    content += `## References\n\n${proposal.references.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
  }

  proposalEl.innerHTML = parseMarkdown(content);
  proposalEl.dataset.rawText = content; // Store raw text for copying
  document.getElementById('proposal-word-count').textContent = `${proposal.wordCount} words`;
}

// ============ Tab Handlers ============
function setupTabHandlers() {
  const tabs = document.querySelectorAll('.tab');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;

      // Update active tab
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update active pane
      document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
      });
      document.getElementById(`tab-${tabId}`).classList.add('active');
    });
  });
}

// ============ Utility Functions ============
function showSection(section) {
  formSection.style.display = section === 'form' ? 'block' : 'none';
  progressSection.style.display = section === 'progress' ? 'block' : 'none';
  resultsSection.style.display = section === 'results' ? 'block' : 'none';
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function copyToClipboard(elementId, text) {
  let textToCopy = text;
  
  if (elementId) {
    const element = document.getElementById(elementId);
    // Use raw text from data attribute if available (for markdown content)
    textToCopy = element.dataset.rawText || element.textContent;
  }

  navigator.clipboard.writeText(textToCopy).then(() => {
    // Show brief feedback
    const originalText = event?.target?.textContent;
    if (event?.target) {
      event.target.textContent = '✓ Copied!';
      setTimeout(() => {
        event.target.textContent = originalText;
      }, 1500);
    }
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

function startNew() {
  currentResults = null;
  applicationForm.reset();
  document.getElementById('cvFileName').textContent = 'Click to upload or drag & drop (PDF)';
  document.getElementById('cvUpload').classList.remove('has-file');
  const contextImageFileName = document.getElementById('contextImageFileName');
  const contextImageUpload = document.getElementById('contextImageUpload');
  if (contextImageFileName) {
    contextImageFileName.textContent = 'Upload optional screenshot/image context';
  }
  if (contextImageUpload) {
    contextImageUpload.classList.remove('has-file');
  }
  showSection('form');
}

// Make copyToClipboard available globally
window.copyToClipboard = copyToClipboard;
window.startNew = startNew;
