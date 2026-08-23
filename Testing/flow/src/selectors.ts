// Live Google Flow & Extension Selectors
export const SELECTORS = {
  // Navigation & Project
  createProjectButton: 'button:has(i:contains("add_2")), button:contains("Dự án mới")',
  backProjectButton: 'button:has(i:contains("arrow_back"))',
  
  // Prompt Input & Submit
  promptTextarea: 'div[role="textbox"], div[contenteditable="true"], textarea.p-textarea, textarea',
  submitButton: 'button:has(i:contains("arrow_forward")), button:has(svg)',
  stopButton: 'button:has(i:contains("stop"))',

  // Modes & Settings
  configButton: 'button:has(i:contains("crop")), button:has(i:contains("tune"))',
  modelSelectButton: 'div[data-state="open"] button:has(i:contains("arrow_drop_down"))',
  selectVideoMode: 'div[data-state="open"] div[role="tablist"]:eq(0) button:eq(1), button:contains("Video")',
  selectImageMode: 'div[data-state="open"] div[role="tablist"]:eq(0) button:eq(0), button:contains("Hình ảnh")',
  textToVideoModeOption: 'div[data-state="open"] div[role="tablist"]:eq(1) button:eq(1)',
  imageToVideoModeOption: 'div[data-state="open"] div[role="tablist"]:eq(1) button:eq(0)',
  componentToVideoModeOption: 'div[data-state="open"] div[role="tablist"]:eq(1) button:eq(1)',
  enableAgentModeButton: 'div:has(div[data-scroll-state="START"]) button[aria-pressed="false"], button:has(i:contains("expand_content"))',
  disableAgentModeButton: 'div:has(div[data-scroll-state="START"]) button[aria-pressed="true"]',

  // Outputs & Download
  outputItems: 'div > div > div[data-tile-id]:has(div)',
  tileOnQueue: 'i:contains("movie"), div[style*="brightness(1)"]',
  moreOptionsButtonInHoverTile: 'button:has(i:contains("more_vert"))',
  downloadButtonInHoverTile: 'div[aria-haspopup="menu"] i:contains("download")',
  quality1080Option: 'button:has(span:contains("1080p")), button:contains("1080p")',
  quality2KOption: 'button:has(span:contains("2K")), button:contains("2K")',
  quality4KOption: 'button:has(span:contains("4K")), button:contains("4K")',

  // Legacy / Extension side panel components
  popup: '#popup-container, .popup, [data-popup], #app, #root',
  sidePanel: 'side-panel, [data-side-panel], #autoflow-panel, .side-panel',
  startIndexInput: 'input.p-inputnumber-input, #start-index, input[name*="index" i]',
  dropdown: '.p-dropdown, .p-select, select, [role="combobox"], #dropdown-select',
  checkbox: '.p-inputswitch, .p-toggleswitch, input[type="checkbox"], #checkbox-input',
  startButton: 'button.p-button, button.start-btn, button.run-btn, button[type="submit"], #start-button, button:has(svg)'
};