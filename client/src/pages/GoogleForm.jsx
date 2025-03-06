import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from "react-router-dom";


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

  // Configurable parameters
  const SOUND_THRESHOLD = 0.3; // Threshold for "high" sound (0-1)
  const SOUND_CHECK_INTERVAL = 150; // Check sound level every 200ms
  const ALERT_DURATION = 3000; // Show alert for 3 seconds

 const google_form_link = localStorage.getItem("drivelink");  
  // Google Form iframe URL - replace YOUR_FORM_ID with your actual Google Form ID
  const googleFormEmbedURL = google_form_link;
  
  // Initialize webcam with error handling
  const startCamera = async () => {
    try {
      // Reset any previous errors
      setCameraError(null);
      
      // Request camera access with fallback options
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
      
      // Set specific error message based on the error
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError("No camera detected. Please connect a camera and try again.");
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError("Camera access denied. Please allow camera access in your browser settings.");
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setCameraError("Camera is already in use by another application.");
      } else {
        setCameraError(`Could not access webcam: ${err.message}`);
      }
    }
  };
  
  // Initialize audio monitoring
  const startAudioMonitoring = async () => {
    try {
      setAudioError(null);
      
      // Request microphone access
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneStreamRef.current = audioStream;
      
      // Set up audio analysis
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(audioStream);
      
      analyser.fftSize = 256;
      microphone.connect(analyser);
      // Don't connect to destination to avoid feedback
      
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      dataArrayRef.current = dataArray;
      
      // Start monitoring sound levels
      soundCheckIntervalRef.current = setInterval(() => {
        if (analyserRef.current && dataArrayRef.current) {
          analyserRef.current.getByteFrequencyData(dataArrayRef.current);
          
          // Calculate average volume level (0-1)
          let sum = 0;
          for (let i = 0; i < dataArrayRef.current.length; i++) {
            sum += dataArrayRef.current[i];
          }
          const average = sum / dataArrayRef.current.length / 255;
          
          setSoundLevel(average);
          
          // Check if sound is above threshold
          if (average > SOUND_THRESHOLD && !isHighSound) {
            setIsHighSound(true);
            setShowSoundAlert(true);
            setSoundAlertCount(prev => prev + 1);
            
            // Hide alert after duration
            setTimeout(() => {
              setShowSoundAlert(false);
            }, ALERT_DURATION);
          } else if (average <= SOUND_THRESHOLD && isHighSound) {
            setIsHighSound(false);
          }
        }
      }, SOUND_CHECK_INTERVAL);
      
      setIsAudioMonitoring(true);
      
    } catch (err) {
      console.error("Error accessing microphone:", err);
      
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setAudioError("No microphone detected. Please connect a microphone and try again.");
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setAudioError("Microphone access denied. Please allow microphone access in your browser settings.");
      } else {
        setAudioError(`Could not access microphone: ${err.message}`);
      }
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
  
  // Capture image from webcam
  const captureImage = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      
      // Set canvas dimensions to match video
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      
      // Draw video frame to canvas
      context.drawImage(
        videoRef.current, 
        0, 0, 
        canvasRef.current.width, 
        canvasRef.current.height
      );
      
      // Get image as data URL
      const imageDataURL = canvasRef.current.toDataURL('image/jpeg');
      setCapturedImage(imageDataURL);
      
      // Stop camera after capturing
      stopCamera();
    }
  };
  
  // Enter full screen mode
  const enterFullScreen = () => {
    if (containerRef.current) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen();
      } else if (containerRef.current.mozRequestFullScreen) {
        containerRef.current.mozRequestFullScreen();
      } else if (containerRef.current.webkitRequestFullscreen) {
        containerRef.current.webkitRequestFullscreen();
      } else if (containerRef.current.msRequestFullscreen) {
        containerRef.current.msRequestFullscreen();
      }
    }
  };
  
  // Exit full screen mode
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
  
  // Start test mode - activates everything
  const startTest = () => {
    startCamera();
    startAudioMonitoring();
    enterFullScreen();
    setIsTestMode(true);
    setTabSwitchCount(0);
    setSoundAlertCount(0);
  };
  
  // End test mode - deactivates everything
  const endTest = () => {
    stopCamera();
    stopAudioMonitoring();
    exitFullScreen();
    setIsTestMode(false);
  };
  
  // Handle fullscreen change events
  useEffect(() => {
    const handleFullScreenChange = () => {
      const isDocFullScreen = document.fullscreenElement || 
                             document.mozFullScreenElement || 
                             document.webkitFullscreenElement || 
                             document.msFullscreenElement;
      
      setIsFullScreen(!!isDocFullScreen);
      
      // If exiting full screen, end test mode automatically
      if (!isDocFullScreen && isTestMode) {
        setIsTestMode(false);
        stopCamera();
        stopAudioMonitoring();
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
  }, [isTestMode]);
  
  // Tab visibility change detection
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (isTestMode && document.visibilityState === 'hidden') {
        setTabSwitchCount(prev => prev + 1);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isTestMode]);
  
  // Window blur detection (additional tab switch detection)
  useEffect(() => {
    const handleWindowBlur = () => {
      if (isTestMode) {
        setTabSwitchCount(prev => prev + 1);
      }
    };
    
    window.addEventListener('blur', handleWindowBlur);
    
    return () => {
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [isTestMode]);
  
  // Cleanup function when component unmounts
  useEffect(() => {
    return () => {
      stopCamera();
      stopAudioMonitoring();
      if (isFullScreen) {
        exitFullScreen();
      }
    };
  }, [isFullScreen]);

  // Check if browser supports required APIs
  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("Your browser doesn't support webcam access. Please try a modern browser like Chrome, Firefox, or Edge.");
      setAudioError("Your browser doesn't support microphone access. Please try a modern browser like Chrome, Firefox, or Edge.");
    }
  }, []);
  
  return (
    <div ref={containerRef} className="flex flex-col bg-gray-100 min-h-screen">
      {/* Header Bar */}
      <div className={`bg-blue-600 text-white p-3 ${isTestMode ? 'sticky top-0 z-10' : ''}`}>
        <div className="flex justify-between items-center">
          <h1 className="text-xl font-bold">Advanced Form Monitoring System</h1>
          
          {isTestMode ? (
            <div className="flex items-center space-x-4">
              <div className="text-sm font-medium bg-blue-700 px-3 py-1 rounded-full">
                Tab Switches: <span className={tabSwitchCount > 0 ? 'text-red-300 font-bold' : 'text-green-300'}>{tabSwitchCount}</span>
              </div>
              <div className="text-sm font-medium bg-blue-700 px-3 py-1 rounded-full">
                Sound Alerts: <span className={soundAlertCount > 0 ? 'text-red-300 font-bold' : 'text-green-300'}>{soundAlertCount}</span>
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
            >
              Start Test in Full Screen
            </button>
          )}
        </div>
      </div>
      
      {/* Main Content */}
      <div className={`flex flex-col md:flex-row gap-6 p-4 flex-grow ${isTestMode ? 'max-w-full' : 'max-w-6xl mx-auto'}`}>
        {/* Webcam and Audio Monitoring Section */}
        <div className={`bg-white rounded-lg shadow-md p-4 ${isTestMode ? 'w-full md:w-1/3' : 'w-full md:w-1/2'}`}>
          <h2 className="text-xl font-bold mb-4 text-center">Monitoring System</h2>
          
          {/* Sound Alert */}
          {showSoundAlert && (
            <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-3 mb-4 rounded shadow-md animate-pulse">
              <div className="flex items-center">
                <svg className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                </svg>
                <p className="font-bold">High Sound Level Detected!</p>
              </div>
              <p className="text-sm mt-1">The ambient noise in your environment is too high. Please reduce background noise.</p>
            </div>
          )}
          
          {/* Status Indicators */}
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
          
          {/* Webcam Display */}
          <div className="relative bg-black rounded-lg overflow-hidden mb-4">
            {isCameraActive ? (
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                className="w-full h-64 object-cover"
                onLoadedMetadata={() => {
                  if (videoRef.current) {
                    videoRef.current.play().catch(e => {
                      console.error("Error playing video:", e);
                      setCameraError("Could not play video stream. Please try again.");
                    });
                  }
                }}
              />
            ) : capturedImage ? (
              <img 
                src={capturedImage} 
                alt="Captured" 
                className="w-full h-64 object-cover"
              />
            ) : (
              <div className="w-full h-64 bg-gray-200 flex items-center justify-center">
                {cameraError ? (
                  <p className="text-red-500 text-center p-4">{cameraError}</p>
                ) : (
                  <p className="text-gray-500">Camera inactive</p>
                )}
              </div>
            )}
            
            {/* Hidden canvas for image capture */}
            <canvas 
              ref={canvasRef}
              className="hidden"
            />
          </div>
          
          {/* Sound Level Meter */}
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
                style={{ width: `${Math.min(soundLevel * 100, 100)}%` }}>
              </div>
            </div>
            {audioError && (
              <p className="text-red-500 text-sm mt-1">{audioError}</p>
            )}
          </div>
          
          {/* Statistics */}
          <div className="mb-4 bg-gray-100 p-3 rounded-lg">
            <h3 className="font-medium mb-2 text-sm">Activity Statistics</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-500">Tab Switches</div>
                <div className={`font-bold ${tabSwitchCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {tabSwitchCount}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Sound Alerts</div>
                <div className={`font-bold ${soundAlertCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {soundAlertCount}
                </div>
              </div>
            </div>
          </div>
          
          {/* Manual Control Buttons (visible when not in test mode) */}
          {!isTestMode && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              {/* Camera Controls */}
              <div>
                <h3 className="text-sm font-semibold mb-1">Camera</h3>
                <div className="flex gap-2">
                  {!isCameraActive && !capturedImage ? (
                    <button
                      type="button"
                      onClick={startCamera}
                      className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 flex-1 text-sm"
                    >
                      Start Camera
                    </button>
                  ) : isCameraActive ? (
                    <>
                      <button
                        type="button"
                        onClick={captureImage}
                        className="bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600 text-xs flex-1"
                      >
                        Capture
                      </button>
                      <button
                        type="button"
                        onClick={stopCamera}
                        className="bg-gray-500 text-white px-2 py-1 rounded hover:bg-gray-600 text-xs flex-1"
                      >
                        Stop
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setCapturedImage(null);
                        startCamera();
                      }}
                      className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 flex-1 text-sm"
                    >
                      Retake
                    </button>
                  )}
                </div>
              </div>
              
              {/* Audio Monitoring Controls */}
              <div>
                <h3 className="text-sm font-semibold mb-1">Sound Monitor</h3>
                <div className="flex gap-2">
                  {!isAudioMonitoring ? (
                    <button
                      type="button"
                      onClick={startAudioMonitoring}
                      className="bg-purple-500 text-white px-3 py-1 rounded hover:bg-purple-600 flex-1 text-sm"
                    >
                      Start
                    </button>
                  ) : (
                    <button
                      type="button"
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
          
          {/* Captured Image Display */}
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
        
        {/* Google Form Section */}
        <div className={`google-form-section bg-white rounded-lg shadow-md p-4 ${isTestMode ? 'w-full md:w-2/3' : 'w-full md:w-1/2'}`}>
          <h2 className="text-xl font-bold mb-4 text-center">Assessment Form</h2>
          
          {isTestMode && (
            <div className="mb-4 bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded-lg">
              <p className="text-sm font-medium text-yellow-800">
                <span className="font-bold">Test in Progress:</span> Please complete the form below. Do not switch tabs or make excessive noise.
              </p>
            </div>
          )}
          
          <div className={`google-form-container overflow-auto border border-gray-200 rounded ${isTestMode ? 'h-screen max-h-[calc(100vh-240px)]' : 'h-96'}`}>
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
          </div>
          
          {!isTestMode && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm">
                <strong>Instructions:</strong> Click "Start Test in Full Screen" button to begin the assessment. The system will monitor for tab switches and high sound levels. Both will be recorded and reported.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdvancedFormMonitoringSystem;