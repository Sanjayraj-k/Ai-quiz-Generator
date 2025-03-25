import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Camera, X } from 'lucide-react';

const WebCam = () => {
  const [isActive, setIsActive] = useState(false);
  const [proctorData, setProctorData] = useState({
    face_detected: false,
    looking_at_screen: false,
    warnings: 0,
    max_warnings: 3,
    violation_detected: false,
    look_direction: 'Unknown',
    eyes_closed: false,
    blink_duration: 0,
    long_blink_count: 0,
    head_pose: [0, 0, 0],
    ear: 0
  });
  const [error, setError] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const apiUrl = 'http://localhost:4000';

  // Start webcam and proctoring
  const startProctoring = async () => {
    try {
      // Reset any previous errors
      setError(null);
      
      // Request webcam access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 640, height: 480 }, 
        audio: false 
      });
      
      streamRef.current = stream;
      
      // Set up video element with stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      // Start the exam session on the server
      const response = await fetch(`${apiUrl}/start-exam`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error('Failed to start exam session');
      }
      
      // Start sending frames for processing
      startFrameProcessing();
      setIsActive(true);
    } catch (err) {
      setError(`Failed to start webcam: ${err.message}`);
      console.error('Error starting webcam:', err);
    }
  };

  // Stop proctoring
  const stopProctoring = async () => {
    // Clear the frame sending interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    // Stop webcam stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // End the exam session on the server
    try {
      await fetch(`${apiUrl}/end-exam`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      console.error('Error ending exam session:', err);
    }
    
    setIsActive(false);
  };

  // Capture and send frames to the server
  const startFrameProcessing = () => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    
    // Set up a new interval for sending frames
    intervalRef.current = setInterval(() => {
      if (videoRef.current && canvasRef.current && videoRef.current.readyState === 4) {
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        
        // Set canvas size to match video
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        
        // Draw the current video frame to the canvas
        context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        
        // Get the image data as base64
        const imageData = canvas.toDataURL('image/jpeg', 0.7);
        
        // Send the image data to the server
        sendFrameToServer(imageData);
      }
    }, 200); // Process 5 frames per second
  };

  // Send a single frame to the server for processing
  const sendFrameToServer = async (imageData) => {
    try {
      const response = await fetch(`${apiUrl}/process-frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData })
      });
      
      if (!response.ok) {
        throw new Error('Server processing error');
      }
      
      const data = await response.json();
      setProctorData(data);
    } catch (err) {
      console.error('Error processing frame:', err);
      // Don't set error state here to avoid flooding with errors
      // Just log to console
    }
  };

  // Clean up on component unmount
  useEffect(() => {
    startProctoring();
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Get status icon based on proctor data
  const getStatusIcon = () => {
    if (proctorData.violation_detected) {
      return <AlertCircle size={24} className="text-red-500" />;
    }
    if (!proctorData.face_detected) {
      return <AlertTriangle size={24} className="text-yellow-500" />;
    }
    if (proctorData.looking_at_screen) {
      return <CheckCircle size={24} className="text-green-500" />;
    }
    return <AlertTriangle size={24} className="text-yellow-500" />;
  };

  // Get status text color class
  const getStatusColorClass = () => {
    if (proctorData.violation_detected) return "text-red-500";
    if (!proctorData.face_detected) return "text-yellow-500";
    if (proctorData.looking_at_screen) return "text-green-500";
    return "text-yellow-500";
  };

  return (
    <div className="w-full max-w-3xl mx-auto p-4 bg-gray-50 rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4">Exam Proctoring System</h2>
      
      {/* Error message if any */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-800 rounded-md">
          <p className="flex items-center">
            <AlertCircle className="mr-2" size={16} />
            {error}
          </p>
        </div>
      )}
      
      {/* Video and status display */}
      <div className="flex flex-col md:flex-row gap-4">
        {/* Video feed container */}
        <div className="relative w-full md:w-3/4 mx-auto">
  <div className={`relative aspect-video bg-gray-900 rounded-lg overflow-hidden ${proctorData.violation_detected ? 'border-4 border-red-500' : ''}`}>
    <video 
      ref={videoRef}
      className="w-full h-full object-cover"
      autoPlay
      playsInline
      muted
    />
    
    {/* Overlay warning if violation detected */}
    {proctorData.violation_detected && (
      <div className="absolute inset-0 bg-red-500 bg-opacity-30 flex items-center justify-center">
        <p className="text-white text-xl font-bold">VIOLATION DETECTED</p>
      </div>
    )}
    
    {/* Inactive overlay when not active */}
    {!isActive && (
      <div className="absolute inset-0 bg-black bg-opacity-70 flex items-center justify-center">
        <Camera size={48} className="text-white opacity-50" />
      </div>
    )}
  </div>
  
  {/* Hidden canvas for image processing */}
  <canvas ref={canvasRef} className="hidden" />
</div>
      </div>
        {/* Status panel */}
        <div className="w-full bg-white p-4 rounded-lg shadow">
  <h3 className="text-lg font-semibold mb-3 flex items-center">
    {getStatusIcon()}
    <span className="ml-2">Proctor Status</span>
  </h3>
  
  <div className="grid grid-cols-2 gap-4">
    {/* Left Column */}
    <div className="space-y-3">
      
      
      <div className="flex justify-between p-2 border-b">
        <span className="font-medium">Looking Direction:</span>
        <span className={getStatusColorClass()}>
          {proctorData.look_direction}
        </span>
      </div>
      
      {proctorData.eyes_closed && (
        <div className="flex justify-between p-2 border-b">
          <span className="font-medium">Blink Duration:</span>
          <span className={proctorData.blink_duration > 2 ? "text-red-500" : "text-green-500"}>
            {proctorData.blink_duration.toFixed(1)}s
          </span>
        </div>
      )}
    </div>
    
    {/* Right Column */}
    <div className="space-y-3">
    <div className="flex justify-between p-2 border-b">
        <span className="font-medium">Long Eye Closures:</span>
        <span className={proctorData.long_blink_count > 3 ? "text-red-500" : "text-green-500"}>
          {proctorData.long_blink_count}
        </span>
      </div>
      
     
    </div>
  </div>
  
  {/* Violation Alert - Spans both columns */}
  {proctorData.violation_detected && (
    <div className="mt-4 p-3 bg-red-100 text-red-800 rounded-md text-center font-bold col-span-2">
      EXAM INTEGRITY COMPROMISED
    </div>
  )}
</div>
    </div>
  );
};

export default WebCam;