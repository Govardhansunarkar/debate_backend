/**
 * Advanced Text-to-Speech Service
 * Handles speech synthesis with proper error handling and browser detection
 */

// Detect TTS availability
const detectTTSSupport = () => {
  if (typeof window === 'undefined') {
    return { supported: false, reason: 'No window object' };
  }

  const SpeechSynthesisUtterance = window.SpeechSynthesisUtterance || window.webkitSpeechSynthesisUtterance;
  const speechSynthesis = window.speechSynthesis;

  if (!SpeechSynthesisUtterance || !speechSynthesis) {
    return {
      supported: false,
      reason: 'Speech Synthesis not supported in this browser'
    };
  }

  return {
    supported: true,
    engine: 'Web Speech API',
    features: {
      hasRate: true,
      hasPitch: true,
      hasVolume: true,
      hasVoices: typeof speechSynthesis.getVoices === 'function'
    }
  };
};

// Get available voices
const getAvailableVoices = () => {
  if (!window.speechSynthesis) return [];
  
  let voices = window.speechSynthesis.getVoices();
  
  // If voices not loaded yet, try again in a moment
  if (voices.length === 0) {
    return new Promise((resolve) => {
      const onVoicesChanged = () => {
        voices = window.speechSynthesis.getVoices();
        window.speechSynthesis.onvoiceschanged = null;
        resolve(voices);
      };
      window.speechSynthesis.onvoiceschanged = onVoicesChanged;
      setTimeout(() => {
        resolve(window.speechSynthesis.getVoices());
      }, 500);
    });
  }
  
  return voices;
};

// Select best voice for debate (prefer female, English voices)
const selectBestVoice = (voices) => {
  if (!voices || voices.length === 0) return null;
  
  // Prefer female voices (typically sound better for debates)
  const femaleVoices = voices.filter(v => v.name.toLowerCase().includes('female'));
  if (femaleVoices.length > 0) return femaleVoices[0];
  
  // Fallback to any English voice
  const englishVoices = voices.filter(v => v.lang.includes('en-US') || v.lang.includes('en'));
  if (englishVoices.length > 0) return englishVoices[0];
  
  // Fallback to first voice
  return voices[0];
};

// Advanced TTS with proper configuration
const speakWithAdvancedOptions = (text, options = {}) => {
  return new Promise((resolve, reject) => {
    const support = detectTTSSupport();
    
    if (!support.supported) {
      console.warn(`[TTS] ${support.reason}`);
      resolve(); // Don't fail, just skip
      return;
    }

    try {
      // Cancel any ongoing speech
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        console.log('[TTS] Cancelled ongoing speech');
      }

      // Wait a moment for cancellation to complete
      setTimeout(() => {
        try {
          const utterance = new (window.SpeechSynthesisUtterance || window.webkitSpeechSynthesisUtterance)(text);
          
          // Configure speech parameters
          utterance.rate = options.rate || 0.9; // Slower for clarity
          utterance.pitch = options.pitch || 1.0;
          utterance.volume = options.volume || 0.9; // Slightly lower to prevent distortion
          utterance.lang = options.lang || 'en-US';

          // Set voice if available
          if (options.voice) {
            utterance.voice = options.voice;
          } else {
            // Try to get a good default voice
            const voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) {
              const bestVoice = selectBestVoice(voices);
              if (bestVoice) {
                utterance.voice = bestVoice;
                console.log('[TTS] Selected voice:', bestVoice.name);
              }
            }
          }

          console.log('[TTS] Speaking:', text.substring(0, 50) + '...');
          console.log('[TTS] Settings:', {
            rate: utterance.rate,
            pitch: utterance.pitch,
            volume: utterance.volume,
            lang: utterance.lang
          });

          // Track speech progress
          let hasStarted = false;
          const startTimeout = setTimeout(() => {
            if (!hasStarted) {
              console.warn('[TTS] Speech did not start within 1000ms');
            }
          }, 1000);

          utterance.onstart = () => {
            hasStarted = true;
            clearTimeout(startTimeout);
            console.log('[TTS] Speech started');
          };

          utterance.onend = () => {
            console.log('[TTS] Speech completed successfully');
            resolve();
          };

          utterance.onerror = (event) => {
            console.error('[TTS] Speech error:', event.error);
            // Still resolve - we don't want speech errors to break the debate
            resolve();
          };

          utterance.onpause = () => {
            console.log('[TTS] Speech paused');
          };

          utterance.onresume = () => {
            console.log('[TTS] Speech resumed');
          };

          // Speak
          window.speechSynthesis.speak(utterance);

          // Timeout fallback - if speech doesn't finish within 60 seconds
          const speechTimeout = setTimeout(() => {
            if (window.speechSynthesis.speaking) {
              console.warn('[TTS] Speech timeout - took longer than 60 seconds');
              window.speechSynthesis.cancel();
            }
            resolve();
          }, 60000);

          // Store timeout for cleanup
          utterance.timeoutId = speechTimeout;

        } catch (innerError) {
          console.error('[TTS] Error creating utterance:', innerError);
          resolve(); // Don't fail
        }
      }, 100);

    } catch (err) {
      console.error('[TTS] Error in speakWithAdvancedOptions:', err);
      resolve(); // Don't fail
    }
  });
};

// Simple TTS wrapper (fallback)
const simpleSpeech = (text, options = {}) => {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      console.warn('[TTS] Speech Synthesis not available');
      resolve();
      return;
    }

    try {
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = options.rate || 1;
      utterance.pitch = options.pitch || 1;
      utterance.volume = options.volume || 1;

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      window.speechSynthesis.speak(utterance);
      
      // Timeout
      setTimeout(() => resolve(), 60000);
    } catch (err) {
      console.error('[TTS] Error:', err);
      resolve();
    }
  });
};

// Stop speech
const stopSpeech = () => {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
    console.log('[TTS] Speech stopped');
  }
};

// Check if currently speaking
const isSpeaking = () => {
  return window.speechSynthesis && window.speechSynthesis.speaking;
};

// Get speech status
const getSpeechStatus = () => {
  if (!window.speechSynthesis) {
    return { status: 'unavailable', reason: 'No Speech Synthesis API' };
  }

  return {
    status: window.speechSynthesis.speaking ? 'speaking' : window.speechSynthesis.paused ? 'paused' : 'idle',
    pending: window.speechSynthesis.pending,
    paused: window.speechSynthesis.paused
  };
};

module.exports = {
  speakWithAdvancedOptions,
  simpleSpeech,
  stopSpeech,
  isSpeaking,
  getSpeechStatus,
  detectTTSSupport,
  getAvailableVoices,
  selectBestVoice
};
