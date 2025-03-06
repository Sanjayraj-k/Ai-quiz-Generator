import React, { useState } from 'react';
import {  Route, Routes, useLocation } from 'react-router-dom';
import FaceDetection from "./pages/FaceDetection";
import Layout from "./components/Layout";
import UserSelect from "./pages/UserSelect";
import Protected from "./pages/Protected";
import GoogleFormWithWebcam from './pages/GoogleForm';
import UploadPage from './pages/UploadPage';
function App() {
  const location = useLocation();
  const [resumeData, setResumeData] = useState(null);

  return (
    <div className="App">
      <Routes>
        <Route path='/' element={<UploadPage />} />
        <Route path="/googleform" element={<GoogleFormWithWebcam />} />
        <Route path="/" element={<Layout />}>
          <Route path="/uploadface" element={<UserSelect />} />
          <Route path="face" element={<FaceDetection />} />
          <Route path="protected" element={<Protected />} />
        </Route>
      </Routes>

    </div>
  );
}

export default App;