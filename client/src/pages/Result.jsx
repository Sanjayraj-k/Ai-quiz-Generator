import React, { useState, useEffect } from 'react';
import { ArrowLeft, ArrowRight, AlertCircle, CheckCircle, XCircle } from 'lucide-react';

const QuizResultsPage = () => {
  const [quizResults, setQuizResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [resultsPerPage] = useState(1);

  useEffect(() => {
    fetchQuizResults();
  }, []);

  const fetchQuizResults = async () => {
    setLoading(true);
    setError(null);
    console.log('Starting fetchQuizResults...');

    try {
      // Step 1: Fetch latest form ID
      console.log('Fetching latest form ID...');
      const formIdResponse = await fetch('http://localhost:5000/latest-form-id', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      console.log('Form ID response status:', formIdResponse.status);
      if (!formIdResponse.ok) {
        throw new Error(`Failed to fetch form ID: ${await formIdResponse.text()}`);
      }
      const formIdData = await formIdResponse.json();
      console.log('Form ID data:', formIdData);
      const formId = formIdData.form_id;
      if (!formId) throw new Error('No form ID found');

      // Step 2: Fetch responses
      console.log('Fetching responses for form ID:', formId);
      const responsesFetch = await fetch(`http://localhost:5000/fetch-responses/${formId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      console.log('Responses fetch status:', responsesFetch.status);
      if (!responsesFetch.ok) {
        throw new Error(`Failed to fetch responses: ${await responsesFetch.text()}`);
      }
      const responsesData = await responsesFetch.json();
      console.log('Responses data:', responsesData);

      // Step 3: Evaluate quiz
      console.log('Evaluating quiz...');
      const evaluationResponse = await fetch('http://localhost:5000/evaluate-quiz', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      console.log('Evaluation response status:', evaluationResponse.status);
      if (!evaluationResponse.ok) {
        throw new Error(`Failed to evaluate quiz: ${await evaluationResponse.text()}`);
      }
      const evaluationData = await evaluationResponse.json();
      console.log('Evaluation data:', evaluationData);

      if (!evaluationData || !evaluationData.question_results) {
        throw new Error('Invalid evaluation data');
      }

      setQuizResults(Array.isArray(evaluationData) ? evaluationData : [evaluationData]);
    } catch (err) {
      console.error('Error in fetchQuizResults:', err);
      setError(err.message.includes('SSL') ? 'Network error: Ensure using http://localhost:5000 and no proxy is interfering.' : err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="ml-4 text-lg font-semibold text-gray-700">Loading results...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
        <AlertCircle size={48} className="text-red-500 mb-4" />
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Error Loading Results </h2>
        <p className="text-gray-600">{error}</p>
        <button
          onClick={fetchQuizResults}
          className="mt-6 px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!quizResults || quizResults.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
        <AlertCircle size={48} className="text-yellow-500 mb-4" />
        <h2 className="text-2xl font-bold text-gray-800 mb-2">No Results Found</h2>
        <p className="text-gray-600">No quiz results are available at this time.</p>
      </div>
    );
  }

  const totalPages = Math.ceil(quizResults.length / resultsPerPage);
  const startIndex = currentPage * resultsPerPage;
  const paginatedResults = quizResults.slice(startIndex, startIndex + resultsPerPage);
  const currentResult = paginatedResults[0];

  const handleNextPage = () => {
    if (currentPage < totalPages - 1) setCurrentPage(currentPage + 1);
  };

  const handlePrevPage = () => {
    if (currentPage > 0) setCurrentPage(currentPage - 1);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-indigo-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-xl shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-6">
            <h1 className="text-2xl font-bold text-white">Quiz Results</h1>
            <div className="flex items-center mt-2">
              <div className="flex items-center bg-white bg-opacity-20 rounded-lg px-3 py-1">
                <span className="text-black font-medium mr-2">Score:</span>
                <span className="text-black font-bold">{currentResult.score} / {currentResult.total_questions}</span>
              </div>
              <div className="ml-4 flex items-center bg-white bg-opacity-20 rounded-lg px-3 py-1">
                <span className="text-black font-medium mr-2">Percentage:</span>
                <span className="text-black font-bold">{currentResult.percentage}%</span>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-gray-800">Questions & Answers</h2>
              {totalPages > 1 && (
                <div className="flex items-center text-sm text-gray-600">
                  <span>Result {currentPage + 1} of {totalPages}</span>
                </div>
              )}
            </div>

            <div className="space-y-6">
              {currentResult.question_results.map((result, index) => (
                <div
                  key={index}
                  className={`border rounded-lg p-4 ${
                    result.is_correct ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                  }`}
                >
                  <div className="flex items-start mb-3">
                    <div className="flex-shrink-0 mr-3 mt-1">
                      {result.is_correct ? (
                        <CheckCircle className="w-5 h-5 text-green-500" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-500" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-gray-800 font-medium">
                        Q{index + 1}: {result.question}
                      </h3>
                    </div>
                  </div>
                  <div className="ml-8 space-y-2">
                    <div className="flex items-start">
                      <span className="text-gray-600 font-medium mr-2">Your answer:</span>
                      <span className={result.is_correct ? 'text-green-700' : 'text-red-700'}>
                        {result.user_answer || 'Not answered'}
                      </span>
                    </div>
                    {!result.is_correct && (
                      <div className="flex items-start">
                        <span className="text-gray-600 font-medium mr-2">Correct answer:</span>
                        <span className="text-green-700">{result.correct_answer}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {totalPages > 1 && (
            <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 flex items-center justify-between">
              <button
                onClick={handlePrevPage}
                disabled={currentPage === 0}
                className={`flex items-center text-sm font-medium rounded-md px-3 py-2 ${
                  currentPage === 0 ? 'text-gray-400 cursor-not-allowed' : 'text-blue-600 hover:bg-blue-50'
                }`}
              >
                <ArrowLeft className="w-4 h-4 mr-1" /> Previous
              </button>
              <div className="text-sm text-gray-600">
                {currentPage + 1} of {totalPages}
              </div>
              <button
                onClick={handleNextPage}
                disabled={currentPage === totalPages - 1}
                className={`flex items-center text-sm font-medium rounded-md px-3 py-2 ${
                  currentPage === totalPages - 1 ? 'text-gray-400 cursor-not-allowed' : 'text-blue-600 hover:bg-blue-50'
                }`}
              >
                Next <ArrowRight className="w-4 h-4 ml-1" />
              </button>
            </div>
          )}
        </div>

        <div className="mt-6 text-center text-gray-600">
          <p className="text-lg font-medium">
            {currentResult.percentage >= 70
              ? 'Great job! You passed the quiz.'
              : 'Keep studying! You\'ll do better next time.'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default QuizResultsPage;