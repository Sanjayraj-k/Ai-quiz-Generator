import React, { useState, useRef, useEffect } from 'react';
import Webcam from "./webCam.jsx";
import { useNavigate } from "react-router-dom";

const AdvancedFormMonitoringSystem = () => {
  // Camera and audio states
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isAudioMonitoring, setIsAudioMonitoring] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [audioError, setAudioError] = useState(null);
  const [soundLevel, setSoundLevel] = useState(0);
  const [isHighSound, setIsHighSound] = useState(false);
  const [showSoundAlert, setShowSoundAlert] = useState(false);
  
  // Full screen state
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isTestMode, setIsTestMode] = useState(false);
  
  // Security alert state
  const [showSecurityAlert, setShowSecurityAlert] = useState(false);
  const [securityAlertMessage, setSecurityAlertMessage] = useState("");
  const [fullScreenWarningCount, setFullScreenWarningCount] = useState(0);

  // Google Form state
  const [googleFormEmbedURL, setGoogleFormEmbedURL] = useState(null);
  const [loadingForm, setLoadingForm] = useState(false);
  const [formError, setFormError] = useState(null);

  const navigate = useNavigate();
  
  // Counters
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [soundAlertCount, setSoundAlertCount] = useState(0);
  
  // Refs
  const videoRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const microphoneStreamRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const soundCheckIntervalRef = useRef(null);
  const containerRef = useRef(null);
  const fullScreenCheckIntervalRef = useRef(null);

  // Configurable parameters
  const SOUND_THRESHOLD = 0.3;
  const SOUND_CHECK_INTERVAL = 150;
  const ALERT_DURATION = 3000;
  const MAX_TAB_SWITCHES = 10;
  const MAX_SOUND_ALERTS = 30;
  const FULLSCREEN_CHECK_INTERVAL = 2000;

  // Function to fetch Google Form link from API
  const fetchGoogleFormLink = async () => {
    try {
      setLoadingForm(true);
      setFormError(null);

      const response = await fetch('http://localhost:5000/create-google-form', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to create Google Form');
      }

      const data = await response.json();
      if (data.google_form_link) {
        setGoogleFormEmbedURL(data.google_form_link);
      } else {
        throw new Error('No Google Form link returned');
      }
    } catch (err) {
      console.error("Error fetching Google Form link:", err);
      setFormError(`Failed to load Google Form: ${err.message}`);
    } finally {
      setLoadingForm(false);
    }
  };

  // Check for security violations
  const checkSecurityViolations = () => {
    if (tabSwitchCount > MAX_TAB_SWITCHES) {
      triggerSecurityAlert("Excessive tab switching detected. Your test session has been terminated.");
      return true;
    }
    
    if (soundAlertCount > MAX_SOUND_ALERTS) {
      triggerSecurityAlert("Excessive background noise detected. Your test session has been terminated.");
      return true;
    }
    
    return false;
  };

  // Display security alert and end test
  const triggerSecurityAlert = (message) => {
    setSecurityAlertMessage(message);
    setShowSecurityAlert(true);
    endTest();
    // You might want to save this violation to your backend as well
  };

  // Fetch form link on component mount (optional) or when starting test
  useEffect(() => {
    // Uncomment this if you want to fetch the form on mount
    // fetchGoogleFormLink();
  }, []);

  // Modified startTest to fetch new form
  const startTest = async () => {
    await fetchGoogleFormLink(); // Fetch new form before starting
    if (!formError) { // Only proceed if form was fetched successfully
      startCamera();
      startAudioMonitoring();
      enterFullScreen();
      setIsTestMode(true);
      setTabSwitchCount(0);
      setSoundAlertCount(0);
      setShowSecurityAlert(false);
      setFullScreenWarningCount(0);
      
      // Start checking fullscreen status periodically
      fullScreenCheckIntervalRef.current = setInterval(() => {
        const isDocFullScreen = document.fullscreenElement || document.mozFullScreenElement || 
                                document.webkitFullscreenElement || document.msFullscreenElement;
        
        if (!isDocFullScreen && isTestMode) {
          setFullScreenWarningCount(prev => prev + 1);
          if (fullScreenWarningCount >= 3) {
            triggerSecurityAlert("Test must be taken in full screen mode. Your session has been terminated.");
          } else {
            // Try to re-enter fullscreen
            enterFullScreen();
            alert(`Warning: Please stay in full screen mode. Warning ${fullScreenWarningCount + 1}/3`);
          }
        }
      }, FULLSCREEN_CHECK_INTERVAL);
    }
  };

  // Initialize webcam
  const startCamera = async () => {
    try {
      setCameraError(null);
      const constraints = {
        video: { 
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setIsCameraActive(true);
      }
    } catch (err) {
      console.error("Error accessing webcam:", err);
      setCameraError(err.name === 'NotAllowedError' ? 
        "Camera access denied. Please allow camera access." : 
        `Could not access webcam: ${err.message}`);
    }
  };

  // Initialize audio monitoring
  const startAudioMonitoring = async () => {
    try {
      setAudioError(null);
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneStreamRef.current = audioStream;
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(audioStream);
      analyser.fftSize = 256;
      microphone.connect(analyser);
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      dataArrayRef.current = dataArray;

      soundCheckIntervalRef.current = setInterval(() => {
        if (analyserRef.current && dataArrayRef.current) {
          analyserRef.current.getByteFrequencyData(dataArrayRef.current);
          let sum = 0;
          for (let i = 0; i < dataArrayRef.current.length; i++) {
            sum += dataArrayRef.current[i];
          }
          const average = sum / dataArrayRef.current.length / 255;
          setSoundLevel(average);
          if (average > SOUND_THRESHOLD && !isHighSound) {
            setIsHighSound(true);
            setShowSoundAlert(true);
            setSoundAlertCount(prev => {
              const newCount = prev + 1;
              // Check if we've exceeded the sound alert threshold
              if (newCount > MAX_SOUND_ALERTS) {
                triggerSecurityAlert("Excessive background noise detected. Your test session has been terminated.");
              }
              return newCount;
            });
            setTimeout(() => setShowSoundAlert(false), ALERT_DURATION);
          } else if (average <= SOUND_THRESHOLD && isHighSound) {
            setIsHighSound(false);
          }
        }
      }, SOUND_CHECK_INTERVAL);

      setIsAudioMonitoring(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setAudioError(err.name === 'NotAllowedError' ? 
        "Microphone access denied. Please allow microphone access." : 
        `Could not access microphone: ${err.message}`);
    }
  };

  // Stop audio monitoring
  const stopAudioMonitoring = () => {
    if (microphoneStreamRef.current) {
      microphoneStreamRef.current.getTracks().forEach(track => track.stop());
      microphoneStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(e => console.error("Error closing audio context:", e));
      audioContextRef.current = null;
    }
    if (soundCheckIntervalRef.current) {
      clearInterval(soundCheckIntervalRef.current);
      soundCheckIntervalRef.current = null;
    }
    setIsAudioMonitoring(false);
    setSoundLevel(0);
    setIsHighSound(false);
  };

  // Stop webcam
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setIsCameraActive(false);
    }
  };

  // Capture image
  const captureImage = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      context.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
      const imageDataURL = canvasRef.current.toDataURL('image/jpeg');
      setCapturedImage(imageDataURL);
      stopCamera();
    }
  };

  // Fullscreen controls
  const enterFullScreen = () => {
    if (containerRef.current) {
      containerRef.current.requestFullscreen?.() || 
      containerRef.current.mozRequestFullScreen?.() || 
      containerRef.current.webkitRequestFullscreen?.() || 
      containerRef.current.msRequestFullscreen?.();
    }
  };

  const exitFullScreen = () => {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  };

  // End test
  const endTest = () => {
    if (fullScreenCheckIntervalRef.current) {
      clearInterval(fullScreenCheckIntervalRef.current);
    }
    stopCamera();
    stopAudioMonitoring();
    exitFullScreen();
    setIsTestMode(false);
    navigate('/result');
  };

  // Event listeners
  useEffect(() => {
    const handleFullScreenChange = () => {
      const isDocFullScreen = document.fullscreenElement || document.mozFullScreenElement || 
                              document.webkitFullscreenElement || document.msFullscreenElement;
      setIsFullScreen(!!isDocFullScreen);
      if (!isDocFullScreen && isTestMode) {
        // Full screen exited during test
        setFullScreenWarningCount(prev => prev + 1);
        if (fullScreenWarningCount >= 2) {
          triggerSecurityAlert("Test must be taken in full screen mode. Your session has been terminated.");
        }
      }
    };
    document.addEventListener('fullscreenchange', handleFullScreenChange);
    document.addEventListener('mozfullscreenchange', handleFullScreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullScreenChange);
    document.addEventListener('msfullscreenchange', handleFullScreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullScreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullScreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullScreenChange);
      document.removeEventListener('msfullscreenchange', handleFullScreenChange);
    };
  }, [isTestMode, fullScreenWarningCount]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (isTestMode && document.visibilityState === 'hidden') {
        setTabSwitchCount(prev => {
          const newCount = prev + 1;
          // Check if we've exceeded the tab switch threshold
          if (newCount > MAX_TAB_SWITCHES) {
            triggerSecurityAlert("Excessive tab switching detected. Your test session has been terminated.");
          }
          return newCount;
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isTestMode]);

  useEffect(() => {
    const handleWindowBlur = () => {
      if (isTestMode) {
        setTabSwitchCount(prev => {
          const newCount = prev + 1;
          // Check if we've exceeded the tab switch threshold
          if (newCount > MAX_TAB_SWITCHES) {
            triggerSecurityAlert("Excessive tab switching detected. Your test session has been terminated.");
          }
          return newCount;
        });
      }
    };
    window.addEventListener('blur', handleWindowBlur);
    return () => window.removeEventListener('blur', handleWindowBlur);
  }, [isTestMode]);

  useEffect(() => {
    return () => {
      stopCamera();
      stopAudioMonitoring();
      if (isFullScreen) exitFullScreen();
      if (fullScreenCheckIntervalRef.current) {
        clearInterval(fullScreenCheckIntervalRef.current);
      }
    };
  }, [isFullScreen]);

  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("Your browser doesn't support webcam access.");
      setAudioError("Your browser doesn't support microphone access.");
    }
  }, []);

  return (
    <div ref={containerRef} className="flex flex-col bg-gray-100 min-h-screen">
      <div className={`bg-blue-600 text-white p-3 ${isTestMode ? 'sticky top-0 z-10' : ''}`}>
        <div className="flex justify-between items-center">
          <h1 className="text-xl font-bold">Advanced Form Monitoring System</h1>
          {isTestMode ? (
            <div className="flex items-center space-x-4">
              <div className="text-sm font-medium bg-blue-700 px-3 py-1 rounded-full">
                Tab Switches: <span className={tabSwitchCount > 0 ? `text-${tabSwitchCount > MAX_TAB_SWITCHES/2 ? 'red' : 'yellow'}-300 font-bold` : 'text-green-300'}>{tabSwitchCount}</span>
              </div>
              <div className="text-sm font-medium bg-blue-700 px-3 py-1 rounded-full">
                Sound Alerts: <span className={soundAlertCount > 0 ? `text-${soundAlertCount > MAX_SOUND_ALERTS/2 ? 'red' : 'yellow'}-300 font-bold` : 'text-green-300'}>{soundAlertCount}</span>
              </div>
              <button
                onClick={endTest}
                className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm"
              >
                End Test
              </button>
            </div>
          ) : (
            <button
              onClick={startTest}
              className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded"
              disabled={loadingForm}
            >
              {loadingForm ? 'Creating Form...' : 'Start Test in Full Screen'}
            </button>
          )}
        </div>
      </div>

      {showSecurityAlert && (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-gray-900 bg-opacity-75">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-md">
            <div className="text-red-600 text-center mb-4">
              <svg className="h-12 w-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h2 className="text-xl font-bold mt-2">Unusual Activity Detected</h2>
            </div>
            <p className="text-gray-700 mb-4">{securityAlertMessage}</p>
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => setShowSecurityAlert(false)}
                className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`flex flex-col md:flex-row gap-6 p-4 flex-grow ${isTestMode ? 'max-w-full' : 'max-w-6xl mx-auto'}`}>
        <div className={`bg-white rounded-lg shadow-md p-4 ${isTestMode ? 'w-full md:w-1/3' : 'w-full md:w-1/2'}`}>
          <h2 className="text-xl font-bold mb-4 text-center">Monitoring System</h2>
          
          {showSoundAlert && (
            <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-3 mb-4 rounded shadow-md animate-pulse">
              <div className="flex items-center">
                <svg className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                </svg>
                <p className="font-bold">High Sound Level Detected!</p>
              </div>
              <p className="text-sm mt-1">Please reduce background noise.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className={`p-3 rounded-lg ${isTestMode ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
              <div className="text-sm font-medium">Test Mode</div>
              <div className="font-bold">{isTestMode ? 'Active' : 'Inactive'}</div>
            </div>
            <div className={`p-3 rounded-lg ${isFullScreen ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
              <div className="text-sm font-medium">Full Screen</div>
              <div className="font-bold">{isFullScreen ? 'Active' : 'Inactive'}</div>
            </div>
          </div>

          <div className="relative bg-black rounded-lg overflow-hidden mb-4">
            <Webcam />
          </div>

          <div className="mb-4">
            <div className="flex justify-between mb-1">
              <span className="text-sm font-medium">Sound Level</span>
              <span className={`text-sm font-medium ${isHighSound ? 'text-red-600' : 'text-green-600'}`}>
                {isHighSound ? 'High' : 'Normal'}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div 
                className={`h-2.5 rounded-full ${isHighSound ? 'bg-red-600' : 'bg-green-500'}`} 
                style={{ width: `${Math.min(soundLevel * 100, 100)}%` }}
              ></div>
            </div>
            {audioError && <p className="text-red-500 text-sm mt-1">{audioError}</p>}
          </div>

          <div className="mb-4 bg-gray-100 p-3 rounded-lg">
            <h3 className="font-medium mb-2 text-sm">Activity Statistics</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-500">Tab Switches</div>
                <div className={`font-bold ${
                  tabSwitchCount === 0 ? 'text-green-600' :
                  tabSwitchCount > MAX_TAB_SWITCHES ? 'text-red-600' :
                  tabSwitchCount > MAX_TAB_SWITCHES/2 ? 'text-yellow-600' : 'text-green-600'
                }`}>
                  {tabSwitchCount} {tabSwitchCount > MAX_TAB_SWITCHES/2 && tabSwitchCount <= MAX_TAB_SWITCHES && <span className="text-xs">⚠️</span>}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Sound Alerts</div>
                <div className={`font-bold ${
                  soundAlertCount === 0 ? 'text-green-600' :
                  soundAlertCount > MAX_SOUND_ALERTS ? 'text-red-600' :
                  soundAlertCount > MAX_SOUND_ALERTS/2 ? 'text-yellow-600' : 'text-green-600'
                }`}>
                  {soundAlertCount} {soundAlertCount > MAX_SOUND_ALERTS/2 && soundAlertCount <= MAX_SOUND_ALERTS && <span className="text-xs">⚠️</span>}
                </div>
              </div>
            </div>
          </div>

          {!isTestMode && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div>
                <h3 className="text-sm font-semibold mb-1">Camera</h3>
                <div className="flex gap-2">
                  {!isCameraActive && !capturedImage ? (
                    <button
                      onClick={startCamera}
                      className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 flex-1 text-sm"
                    >
                      Start Camera
                    </button>
                  ) : isCameraActive ? (
                    <>
                      <button
                        onClick={captureImage}
                        className="bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600 text-xs flex-1"
                      >
                        Capture
                      </button>
                      <button
                        onClick={stopCamera}
                        className="bg-gray-500 text-white px-2 py-1 rounded hover:bg-gray-600 text-xs flex-1"
                      >
                        Stop
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => { setCapturedImage(null); startCamera(); }}
                      className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 flex-1 text-sm"
                    >
                      Retake
                    </button>
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-1">Sound Monitor</h3>
                <div className="flex gap-2">
                  {!isAudioMonitoring ? (
                    <button
                      onClick={startAudioMonitoring}
                      className="bg-purple-500 text-white px-3 py-1 rounded hover:bg-purple-600 flex-1 text-sm"
                    >
                      Start
                    </button>
                  ) : (
                    <button
                      onClick={stopAudioMonitoring}
                      className="bg-gray-500 text-white px-3 py-1 rounded hover:bg-gray-600 flex-1 text-sm"
                    >
                      Stop
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {capturedImage && !isTestMode && (
            <div className="mt-4">
              <h3 className="font-medium mb-2">Captured Image:</h3>
              <div className="bg-gray-100 p-2 rounded-lg">
                <a 
                  href={capturedImage} 
                  download="webcam-image.jpg" 
                  className="inline-block mt-2 bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
                >
                  Download Image
                </a>
              </div>
            </div>
          )}
        </div>

        <div className={`google-form-section bg-white rounded-lg shadow-md p-4 ${isTestMode ? 'w-full md:w-2/3' : 'w-full md:w-1/2'}`}>
          <h2 className="text-xl font-bold mb-4 text-center">Assessment Form</h2>
          
          {isTestMode && (
            <div className="mb-4 bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded-lg">
              <p className="text-sm font-medium text-yellow-800">
                <span className="font-bold">Test in Progress:</span> Please complete the form below. Do not switch tabs or make excessive noise.
              </p>
              <p className="text-xs mt-1 text-yellow-700">
                <span className="font-bold">Warning:</span> More than {MAX_TAB_SWITCHES} tab switches or {MAX_SOUND_ALERTS} sound alerts will automatically end your test.
              </p>
            </div>
          )}

          <div className={`google-form-container overflow-auto border border-gray-200 rounded ${isTestMode ? 'h-screen max-h-[calc(100vh-240px)]' : 'h-96'}`}>
            {loadingForm ? (
              <div className="text-center p-4">Loading form...</div>
            ) : formError ? (
              <div className="text-red-500 text-center p-4">{formError}</div>
            ) : googleFormEmbedURL ? (
              <iframe 
                src={googleFormEmbedURL}
                width="100%" 
                height="100%" 
                frameBorder="0" 
                marginHeight="0" 
                marginWidth="0"
                className="w-full h-full min-h-96"
              >
                Loading Google Form...
              </iframe>
            ) : (
              <div className="text-center p-4">Click "Start Test" to generate a new form</div>
            )}
          </div>

          {!isTestMode && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm">
                <strong>Instructions:</strong> Click "Start Test in Full Screen" to begin the assessment. A new Google Form will be generated.
              </p>
              <p className="text-xs mt-2 text-blue-700">
                <strong>Note:</strong> The system will monitor for tab switching and background noise. Excessive violations will terminate your test session.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdvancedFormMonitoringSystem;