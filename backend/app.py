import os
import tempfile
import json
from typing import TypedDict, List, Dict
import PyPDF2
from flask import Flask, request, jsonify
from flask_cors import CORS
from pymongo import MongoClient
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_groq import ChatGroq
from langchain_community.document_loaders import PyPDFLoader, TextLoader, Docx2txtLoader
from langsmith import Client
from langchain_core.tracers import LangChainTracer
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain.retrievers import MultiQueryRetriever
from langgraph.graph import END, StateGraph
from bson.objectid import ObjectId
from google.oauth2 import service_account
from googleapiclient.discovery import build
from dotenv import load_dotenv
import datetime
import traceback
from langchain_core.exceptions import LangChainException
from extractorClass import ContextExtractor

app = Flask(__name__)
# Updated CORS configuration to include /create-google-form endpoint
CORS(app, resources={
    r"/api/*": {"origins": "http://localhost:5173"},
    r"/create-google-form": {"origins": "http://localhost:5173"},
    r"/latest-form-id": {"origins": "http://localhost:5173"},
    r"/fetch-responses/*": {"origins": "http://localhost:5173"},
    r"/evaluate-quiz": {"origins": "http://localhost:5173"},
    r"/api/health": {"origins": "http://localhost:5173"}
})

# MongoDB Configuration
MONGO_URI = os.environ.get("MONGO_URI")
try:
    client = MongoClient(MONGO_URI)
    db = client["Question"]
    quiz_collection = db["listofquestion"]
    form_responses_collection = db["form_responses"]
    user_response_collection = db["user_response"]
    print("MongoDB connection successful")
except Exception as e:
    print(f"MongoDB connection failed: {str(e)}")

# Google Forms API Authentication
SERVICE_ACCOUNT_FILE = os.getenv("SERVICE_ACCOUNT_FILE", "service-account.json")
SCOPES = [
    "https://www.googleapis.com/auth/forms.body",
    "https://www.googleapis.com/auth/forms.responses.readonly"
]
try:
    creds = service_account.Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    service = build("forms", "v1", credentials=creds)
    print("Google Forms API initialized successfully")
except Exception as e:
    print(f"Google Forms API initialization failed: {str(e)}")

# API Keys & Config
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "xxxx")
LANGCHAIN_API_KEY = os.environ.get("LANGCHAIN_API_KEY", "xxxxx")
LANGCHAIN_PROJECT = os.environ.get("LANGCHAIN_PROJECT", "xxxxx")
UPLOAD_FOLDER = tempfile.mkdtemp()
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

client = Client(api_key=LANGCHAIN_API_KEY)
tracer = LangChainTracer(project_name=LANGCHAIN_PROJECT)
load_dotenv()

try:
    llm = ChatGroq(
        temperature=0.2,
        model_name="llama-3.3-70b-versatile",
        groq_api_key="xxxxxx"
    )
    print("ChatGroq initialized successfully")
except Exception as e:
    print(f"ChatGroq initialization failed: {str(e)}")

try:
    embeddings = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2"
    )
    print("HuggingFaceEmbeddings initialized successfully")
except Exception as e:
    print(f"HuggingFaceEmbeddings initialization failed: {str(e)}")

try:
    context_extractor = ContextExtractor()
    print("ContextExtractor initialized successfully")
except Exception as e:
    print(f"ContextExtractor initialization failed: {str(e)}")

class GraphState(TypedDict):
    retriever: MultiQueryRetriever
    content: str
    difficulty: str
    num_questions: int
    questions: List[Dict]

def process_document(file_path, file_type=None):
    try:
        print(f"Processing document: {file_path} (type: {file_type})")
        content = context_extractor.extract(file_path)
        print(f"Extracted content length: {len(content) if content else 0}")
        if not content:
            raise ValueError("Failed to extract content from the document")

        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=2000,
            chunk_overlap=200
        )
        chunks = text_splitter.split_text(content)
        print(f"Number of chunks: {len(chunks)}")
        if not chunks:
            raise ValueError("No text chunks created from document")

        print("Creating FAISS vector store...")
        vectorstore = FAISS.from_texts(chunks, embeddings)
        base_retriever = vectorstore.as_retriever(search_kwargs={"k": 4})

        print("Creating MultiQueryRetriever...")
        retriever = MultiQueryRetriever.from_llm(
            retriever=base_retriever,
            llm=llm,
        )
        return retriever
    except Exception as e:
        error_details = traceback.format_exc()
        print(f"Error in process_document: {error_details}")
        raise ValueError(f"Failed to process document: {str(e)}")

def retrieve_content(state: GraphState) -> GraphState:
    try:
        retriever = state.get("retriever")
        difficulty = state.get("difficulty", "medium")
        print(f"Retrieving content for difficulty: {difficulty}")

        if retriever is None:
            raise ValueError("Retriever object is missing")

        query = f"Information for {difficulty} difficulty quiz"
        docs = retriever.invoke(query)
        content = "\n\n".join([doc.page_content for doc in docs]) if docs else ""
        print(f"Retrieved content length: {len(content)}")
        if not content:
            raise ValueError("No relevant content retrieved")

        return {
            "retriever": retriever,
            "content": content,
            "difficulty": difficulty,
            "num_questions": state["num_questions"]
        }
    except Exception as e:
        error_details = traceback.format_exc()
        print(f"Error in retrieve_content: {error_details}")
        raise ValueError(f"Failed to retrieve content: {str(e)}")

def generate_questions(state: GraphState) -> GraphState:
    try:
        content = state["content"]
        difficulty = state["difficulty"]
        num_questions = state["num_questions"]
        print(f"Generating {num_questions} questions (difficulty: {difficulty}, content length: {len(content)})")

        prompt = ChatPromptTemplate.from_template(""" 
        You are an expert quiz creator. Create {num_questions} quiz questions with the following parameters:
        
        1. Difficulty level: {difficulty}
        2. Each question should have four possible answers (A, B, C, D)
        3. One answer should be correct
        4. Only use information found in the provided content
        
        Content:
        {content}
        
        Return the quiz in the following JSON format:
        
        [
            {{"question": "Question text",
              "options": [
                  "A. Option A",
                  "B. Option B", 
                  "C. Option C",
                  "D. Option D"
              ],
              "correct_answer": "A. Option A",
              "explanation": "Brief explanation of why this is correct"
            }}
        ]
        
        Only return the JSON without any additional explanation or text.
        """)

        parser = JsonOutputParser()
        chain = prompt | llm | parser
        questions = chain.invoke({
            "content": content,
            "difficulty": difficulty,
            "num_questions": num_questions
        })
        print(f"Generated {len(questions) if questions else 0} questions")
        if not questions or not isinstance(questions, list):
            raise ValueError("No valid questions generated")
        
        return {"questions": questions}
    except Exception as e:
        error_details = traceback.format_exc()
        print(f"Error in generate_questions: {error_details}")
        raise LangChainException(f"Failed to generate questions: {str(e)}")

def create_quiz_graph():
    workflow = StateGraph(GraphState)
    workflow.add_node("retrieve_content", retrieve_content)
    workflow.add_node("generate_questions", generate_questions)
    workflow.add_edge("retrieve_content", "generate_questions")
    workflow.add_edge("generate_questions", END)
    workflow.set_entry_point("retrieve_content")
    return workflow.compile()

@app.route('/api/generate-quiz', methods=['POST'])
def generate_quiz():
    print("Received request to /api/generate-quiz")
    if 'file' not in request.files and request.form.get('content_type') != 'youtube':
        print("Validation failed: No file part or invalid content type")
        return jsonify({"error": "No file part or invalid content type"}), 400
    
    content_type = request.form.get('content_type', 'pdf')
    print(f"Content type: {content_type}")
    if content_type not in ['pdf', 'docx', 'text', 'youtube', 'audio']:
        print(f"Validation failed: Unsupported content type: {content_type}")
        return jsonify({"error": f"Unsupported content type: {content_type}"}), 400

    if content_type == 'youtube':
        youtube_url = request.form.get('youtube_url')
        print(f"YouTube URL: {youtube_url}")
        if not youtube_url or not youtube_url.strip():
            print("Validation failed: YouTube URL is required")
            return jsonify({"error": "YouTube URL is required for content_type 'youtube'"}), 400
        print("YouTube processing not implemented")
        return jsonify({"error": "YouTube URL processing is not implemented"}), 501

    file = request.files['file']
    if file.filename == '':
        print("Validation failed: No selected file")
        return jsonify({"error": "No selected file"}), 400

    difficulty = request.form.get('difficulty', 'medium')
    print(f"Difficulty: {difficulty}")
    try:
        num_questions = int(request.form.get('num_questions', 5))
        print(f"Number of questions: {num_questions}")
        if num_questions < 1:
            raise ValueError("Number of questions must be at least 1")
    except ValueError as e:
        print(f"Validation failed: Invalid num_questions: {str(e)}")
        return jsonify({"error": f"Invalid num_questions: {str(e)}"}), 400

    file_extension = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'txt'
    file_type = 'pdf' if file_extension == 'pdf' else 'docx' if file_extension in ['doc', 'docx'] else 'audio' if file_extension in ['mp3', 'wav', 'ogg', 'm4a'] else 'text'
    print(f"File: {file.filename}, Extension: {file_extension}, File type: {file_type}")
    if file_type != content_type:
        print(f"Validation failed: File extension ({file_extension}) does not match content type ({content_type})")
        return jsonify({"error": f"File extension ({file_extension}) does not match content type ({content_type})"}), 400

    file_path = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
    print(f"Saving file to: {file_path}")
    try:
        file.save(file_path)
    except Exception as e:
        error_details = traceback.format_exc()
        print(f"Failed to save file: {error_details}")
        return jsonify({"error": f"Failed to save file: {str(e)}", "details": error_details}), 500

    try:
        print("Calling process_document...")
        retriever = process_document(file_path, file_type)
        if not retriever:
            raise ValueError("Failed to create retriever from document")

        print("Creating quiz graph...")
        quiz_graph = create_quiz_graph()
        print("Invoking quiz graph...")
        result = quiz_graph.invoke({
            "retriever": retriever,
            "difficulty": difficulty,
            "num_questions": num_questions
        })

        print("Validating quiz result...")
        if not result.get("questions") or not isinstance(result["questions"], list):
            raise ValueError("No valid questions generated")

        quiz_data = {
            "quiz": result["questions"],
            "metadata": {
                "difficulty": difficulty,
                "num_questions": len(result["questions"]),
                "source": file.filename,
                "class_name": request.form.get('class_name', ''),
                "year_level": request.form.get('year_level', '')
            }
        }
        print(f"Quiz data prepared: {json.dumps(quiz_data, indent=2)}")

        print("Inserting quiz data into MongoDB...")
        try:
            inserted_id = quiz_collection.insert_one(quiz_data).inserted_id
            print(f"Quiz stored successfully with ID: {inserted_id}")
        except Exception as e:
            error_details = traceback.format_exc()
            print(f"MongoDB insertion failed: {error_details}")
            return jsonify({"error": f"MongoDB insertion failed: {str(e)}", "details": error_details}), 500

        print("Returning successful response")
        return jsonify({
            "message": "Quiz successfully generated and stored in MongoDB",
            "quiz_id": str(inserted_id),
            "quiz": result["questions"],
        })

    except ValueError as ve:
        error_details = traceback.format_exc()
        print(f"ValueError in generate_quiz: {error_details}")
        return jsonify({"error": str(ve), "details": error_details}), 400
    except LangChainException as le:
        error_details = traceback.format_exc()
        print(f"LangChainException in generate_quiz: {error_details}")
        return jsonify({"error": f"Language model error: {str(le)}", "details": error_details}), 500
    except Exception as e:
        error_details = traceback.format_exc()
        print(f"Unexpected error in generate_quiz: {error_details}")
        return jsonify({"error": f"Internal server error: {str(e)}", "details": error_details}), 500
    finally:
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                print(f"Temporary file removed: {file_path}")
        except Exception as e:
            print(f"Failed to remove temporary file {file_path}: {str(e)}")
@app.route('/api/get-quiz/<quiz_id>', methods=['GET'])
def get_quiz(quiz_id):
    """Fetch a quiz by its quiz_id from MongoDB."""
    try:
        print(f"Fetching quiz with ID: {quiz_id}")
        try:
            quiz = quiz_collection.find_one({"_id": ObjectId(quiz_id)})
        except Exception as e:
            print(f"Invalid quiz_id format: {str(e)}")
            return jsonify({"error": "Invalid quiz_id format"}), 400

        if not quiz or not quiz.get("quiz"):
            print(f"No quiz found for ID: {quiz_id}")
            return jsonify({"error": "No quiz found"}), 404

        print(f"Found quiz with {len(quiz['quiz'])} questions")
        return jsonify({
            "message": "Quiz retrieved successfully",
            "quiz_id": str(quiz["_id"]),
            "quiz": quiz["quiz"],
            "metadata": quiz["metadata"]
        })

    except Exception as e:
        error_details = traceback.format_exc()
        print(f"Error in get_quiz: {error_details}")
        return jsonify({"error": f"Internal server error: {str(e)}", "details": error_details}), 500

@app.route('/create-google-form', methods=['GET'])
def create_google_form():
    print("Starting create_google_form endpoint")
    try:
        print("Fetching latest quiz from MongoDB...")
        quiz = quiz_collection.find_one(sort=[("_id", -1)])
        if not quiz or not quiz.get("quiz"):
            print("No quizzes found or quiz is empty")
            return jsonify({"error": "No quizzes found or quiz is empty"}), 404

        questions = quiz["quiz"]
        print(f"Found quiz with ID {quiz['_id']} and {len(questions)} questions")
        form_metadata = {"info": {"title": "Auto-Generated Quiz"}}
        print("Creating Google Form...")
        form = service.forms().create(body=form_metadata).execute()
        form_id = form["formId"]
        print(f"Created Google Form with ID: {form_id}")

        requests = [{
            "createItem": {
                "item": {
                    "title": question["question"],
                    "questionItem": {
                        "question": {
                            "required": True,
                            "choiceQuestion": {
                                "type": "RADIO",
                                "options": [{"value": option} for option in question["options"]],
                                "shuffle": False
                            }
                        }
                    }
                },
                "location": {"index": 0}
            }
        } for question in questions]

        print(f"Batch updating Google Form with {len(requests)} questions...")
        service.forms().batchUpdate(formId=form_id, body={"requests": requests}).execute()
        form_link = f"https://docs.google.com/forms/d/{form_id}/viewform"
        print(f"Google Form link: {form_link}")

        print("Updating quiz in MongoDB with form link...")
        quiz_collection.update_one({"_id": quiz["_id"]}, {"$set": {"google_form_link": form_link}})
        print("Storing form response in MongoDB...")
        form_responses_collection.insert_one({
            "quiz_id": quiz["_id"],
            "form_id": form_id,
            "title": "Auto-Generated Quiz",
            "questions": questions,
            "google_form_link": form_link
        })

        print("Returning successful response")
        return jsonify({"message": "Form created successfully", "google_form_link": form_link})

    except Exception as e:
        error_details = traceback.format_exc()
        print(f"Error in create_google_form: {error_details}")
        return jsonify({"error": str(e), "details": error_details}), 500

@app.route('/latest-form-id', methods=['GET'])
def get_latest_form_id():
    try:
        print("Fetching latest form ID...")
        latest_form = form_responses_collection.find_one(sort=[("_id", -1)])
        if not latest_form or "form_id" not in latest_form:
            print("No form responses found")
            return jsonify({"error": "No form responses found"}), 404
        print(f"Latest form ID: {latest_form['form_id']}")
        return jsonify({"form_id": latest_form["form_id"]})
    except Exception as e:
        error_details = traceback.format_exc()
        print(f"Error in get_latest_form_id: {error_details}")
        return jsonify({"error": str(e), "details": error_details}), 500

@app.route('/fetch-responses/<form_id>', methods=['GET'])
def fetch_store_responses(form_id):
    try:
        print(f"Fetching responses for form ID: {form_id}")
        response_data = service.forms().responses().list(formId=form_id).execute()
        if "responses" not in response_data:
            print("No responses found")
            return jsonify({"message": "No responses found"}), 404

        user_responses = []
        for response in response_data["responses"]:
            response_id = response["responseId"]
            response_time = response.get("createTime", "")
            answers = response.get("answers", {})

            formatted_answers = {
                q_id: ans.get("textAnswers", {}).get("answers", [{}])[0].get("value", "")
                for q_id, ans in answers.items()
            }

            user_responses.append({
                "response_id": response_id,
                "response_time": response_time,
                "answers": formatted_answers
            })

        if user_responses:
            print(f"Storing {len(user_responses)} responses in MongoDB...")
            insert_result = user_response_collection.insert_many(user_responses)
            for i, obj_id in enumerate(insert_result.inserted_ids):
                user_responses[i]["_id"] = str(obj_id)
            print("Responses stored successfully")
            return jsonify({
                "message": "Responses stored successfully",
                "data": user_responses
            })

        print("No new responses")
        return jsonify({"message": "No new responses"}), 200
    except Exception as e:
        error_details = traceback.format_exc()
        print(f"Error in fetch_store_responses: {error_details}")
        return jsonify({"error": str(e), "details": error_details}), 500

@app.route('/evaluate-quiz', methods=['POST', 'GET'])
def evaluate_quiz():
    try:
        print("Starting quiz evaluation...")
        response_id = None
        if request.method == 'POST' and request.is_json:
            data = request.get_json(silent=True)
            response_id = data.get("response_id") if data else None
        elif request.method == 'GET':
            response_id = request.args.get("response_id")
        print(f"Response ID: {response_id}")

        user_response = user_response_collection.find_one({"response_id": response_id}) if response_id else user_response_collection.find_one(sort=[("_id", -1)])
        if not user_response:
            print("No user responses found")
            return jsonify({"error": "No user responses found"}), 404

        user_answers = user_response.get("answers", {})
        user_response_id = user_response.get("response_id")
        print(f"User response found: {user_response_id}")

        latest_form_response = form_responses_collection.find_one(sort=[("_id", -1)])
        if not latest_form_response:
            print("No form responses found")
            return jsonify({"error": "No form responses found"}), 404

        form_id = latest_form_response.get("form_id")
        quiz_questions = latest_form_response.get("questions", [])
        print(f"Form ID: {form_id}, Questions: {len(quiz_questions)}")

        if not quiz_questions:
            print("No questions found")
            return jsonify({"error": "No questions found"}), 404

        correct_answers = {q["question"]: q["correct_answer"] for q in quiz_questions}

        question_id_map = {}
        if form_id:
            try:
                print(f"Fetching form structure for form ID: {form_id}")
                form_data = service.forms().get(formId=form_id).execute()
                for item in form_data.get("items", []):
                    question_text = item.get("title", "")
                    question_id = item.get("questionItem", {}).get("question", {}).get("questionId", "")
                    if question_text and question_id:
                        question_id_map[question_id] = question_text
            except Exception as e:
                print(f"Warning: Could not fetch form structure: {str(e)}")

        score = 0
        total_questions = len(quiz_questions)
        question_results = []

        for question_data in quiz_questions:
            question_text = question_data["question"]
            correct_answer = question_data["correct_answer"]
            
            user_answer = ""
            if question_id_map:
                for q_id, q_text in question_id_map.items():
                    if q_text.strip() == question_text.strip() and q_id in user_answers:
                        user_answer = user_answers[q_id].strip()
                        break
            else:
                for answer_key, answer_value in user_answers.items():
                    if question_text in answer_key or answer_key in question_text:
                        user_answer = answer_value.strip()
                        break

            is_correct = user_answer == correct_answer
            if is_correct:
                score += 1

            question_results.append({
                "question": question_text,
                "correct_answer": correct_answer,
                "user_answer": user_answer,
                "is_correct": is_correct
            })

        percentage_score = (score / total_questions * 100) if total_questions > 0 else 0
        print(f"Score: {score}/{total_questions} ({percentage_score}%)")

        evaluation_result = {
            "user_response_id": str(user_response["_id"]),
            "response_id": user_response_id,
            "form_id": form_id,
            "score": score,
            "percentage": round(percentage_score, 2),
            "total_questions": total_questions,
            "question_results": question_results,
            "evaluated_at": datetime.datetime.now().isoformat()
        }

        print("Updating user response in MongoDB...")
        user_response_collection.update_one(
            {"_id": user_response["_id"]},
            {"$set": evaluation_result}
        )

        print("Returning evaluation result")
        return jsonify(evaluation_result)

    except Exception as e:
        error_details = traceback.format_exc()
        print(f"Error in evaluate_quiz: {error_details}")
        return jsonify({"error": str(e), "details": error_details}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    print("Health check requested")
    return jsonify({"status": "healthy"}), 200

if __name__ == "__main__":
    print("Starting Flask server...")
    app.run(debug=True, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
