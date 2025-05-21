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
from extractorClass import ContextExtractor 
import traceback# Assuming this is your custom class

app = Flask(__name__)
CORS(app)

# MongoDB Configuration
MONGO_URI = "mongodb://localhost:27017"  # Change if using cloud DB
client = MongoClient(MONGO_URI)
db = client["Question"]  # Database Name
quiz_collection = db["listofquestion"]
form_responses_collection = db["form_responses"]  # Plural as specified
user_response_collection = db["user_response"]    # Singular as specified

# Google Forms API Authentication
SERVICE_ACCOUNT_FILE = os.getenv("SERVICE_ACCOUNT_FILE", "service-account.json")
SCOPES = [
    "https://www.googleapis.com/auth/forms.body",
    "https://www.googleapis.com/auth/forms.responses.readonly"
]
creds = service_account.Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=SCOPES)
service = build("forms", "v1", credentials=creds)

# API Keys & Config
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "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")
LANGCHAIN_API_KEY = os.environ.get("LANGCHAIN_API_KEY", "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")
LANGCHAIN_PROJECT = os.environ.get("LANGCHAIN_PROJECT", "quiz-generator1")
UPLOAD_FOLDER = tempfile.mkdtemp()
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

client = Client(api_key=LANGCHAIN_API_KEY)
tracer = LangChainTracer(project_name=LANGCHAIN_PROJECT)
load_dotenv()

llm = ChatGroq(
    temperature=0.2,
    model_name="llama-3.3-70b-versatile",
    groq_api_key=GROQ_API_KEY,
)

embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

context_extractor = ContextExtractor()

class GraphState(TypedDict):
    retriever: MultiQueryRetriever
    content: str
    difficulty: str
    num_questions: int
    questions: List[Dict]

def process_document(file_path, file_type=None):
    """Loads the document, splits it into chunks, and creates a retriever."""
    content = context_extractor.extract(file_path)
    if not content:
        raise ValueError("Failed to extract content from the document")

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=2000,
        chunk_overlap=200
    )
    chunks = text_splitter.split_text(content)

    vectorstore = FAISS.from_texts(chunks, embeddings)
    base_retriever = vectorstore.as_retriever(search_kwargs={"k": 4})

    retriever = MultiQueryRetriever.from_llm(
        retriever=base_retriever,
        llm=llm,
    )
    return retriever

def retrieve_content(state: GraphState) -> GraphState:
    """Retrieve relevant content based on difficulty level."""
    retriever = state.get("retriever")
    difficulty = state.get("difficulty", "medium")
    if retriever is None:
        raise ValueError("Retriever object is missing")

    query = f"Information for {difficulty} difficulty quiz"
    docs = retriever.get_relevant_documents(query)
    content = "\n\n".join([doc.page_content for doc in docs]) if docs else "No relevant content found."
    
    return {
        "retriever": retriever,
        "content": content,
        "difficulty": difficulty,
        "num_questions": state["num_questions"]
    }

def generate_questions(state: GraphState) -> GraphState:
    """Generate quiz questions based on content."""
    content = state["content"]
    difficulty = state["difficulty"]
    num_questions = state["num_questions"]

    prompt = ChatPromptTemplate.from_template("""
    You are an expert quiz creator. Create {num_questions} quiz questions with the following parameters:
    
    1. Difficulty level: {difficulty}
    2. Each question should have four possible answers (A, B, C, D)
    3. One answer should be correct
    4. Only use information found in the provided content
    
    Content:
    {content}
    
    Return the quiz in the following JSON format:
    
    json
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
    
    return {"questions": questions}

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
    """Handles file upload and generates a quiz, storing it in MongoDB."""
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    difficulty = request.form.get('difficulty', 'medium')
    num_questions = int(request.form.get('num_questions', 5))
    
    file_extension = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'txt'
    file_type = 'pdf' if file_extension == 'pdf' else 'docx' if file_extension in ['doc', 'docx'] else 'text'

    file_path = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
    file.save(file_path)
    
    try:
        retriever = process_document(file_path, file_type)
        quiz_graph = create_quiz_graph()
        result = quiz_graph.invoke({
            "retriever": retriever,
            "difficulty": difficulty,
            "num_questions": num_questions
        })

        quiz_data = {
            "quiz": result["questions"],
            "metadata": {
                "difficulty": difficulty,
                "num_questions": len(result["questions"]),
                "source": file.filename
            }
        }

        inserted_id = quiz_collection.insert_one(quiz_data).inserted_id

        return jsonify({
            "message": "Quiz successfully generated and stored in MongoDB",
            "quiz_id": str(inserted_id),
            "quiz": result["questions"],
        })
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)

@app.route('/create-google-form', methods=['GET'])
def create_google_form():
    """Fetch the latest quiz from MongoDB, create a Google Form, and store the response."""
    try:
        quiz = quiz_collection.find_one(sort=[("_id", -1)])
        if not quiz or not quiz.get("quiz"):
            return jsonify({"error": "No quizzes found or quiz is empty"}), 404

        questions = quiz["quiz"]
        form_metadata = {"info": {"title": "Auto-Generated Quiz"}}
        form = service.forms().create(body=form_metadata).execute()
        form_id = form["formId"]

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

        service.forms().batchUpdate(formId=form_id, body={"requests": requests}).execute()
        form_link = f"https://docs.google.com/forms/d/{form_id}/viewform"

        quiz_collection.update_one({"_id": quiz["_id"]}, {"$set": {"google_form_link": form_link}})
        form_responses_collection.insert_one({
            "quiz_id": quiz["_id"],
            "form_id": form_id,
            "title": "Auto-Generated Quiz",
            "questions": questions,
            "google_form_link": form_link
        })

        return jsonify({"message": "Form created successfully", "google_form_link": form_link})

    except Exception as e:
        return jsonify({"error": str(e)}), 500
@app.route('/latest-form-id', methods=['GET'])
def get_latest_form_id():
    try:
        latest_form = form_responses_collection.find_one(sort=[("_id", -1)])
        if not latest_form or "form_id" not in latest_form:
            return jsonify({"error": "No form responses found"}), 404
        return jsonify({"form_id": latest_form["form_id"]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/fetch-responses/<form_id>', methods=['GET'])
def fetch_store_responses(form_id):
    try:
        response_data = service.forms().responses().list(formId=form_id).execute()
        if "responses" not in response_data:
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
            insert_result = user_response_collection.insert_many(user_responses)
            for i, obj_id in enumerate(insert_result.inserted_ids):
                user_responses[i]["_id"] = str(obj_id)

            return jsonify({
                "message": "Responses stored successfully",
                "data": user_responses
            })

        return jsonify({"message": "No new responses"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/evaluate-quiz', methods=['POST', 'GET'])
def evaluate_quiz():
    try:
        # Safely get response_id from either JSON body (POST) or query params (GET)
        response_id = None
        if request.method == 'POST' and request.is_json:
            response_id = request.get_json(silent=True).get("response_id") if request.get_json(silent=True) else None
        elif request.method == 'GET':
            response_id = request.args.get("response_id")

        # Fetch user response
        user_response = user_response_collection.find_one({"response_id": response_id}) if response_id else user_response_collection.find_one(sort=[("_id", -1)])
        if not user_response:
            return jsonify({"error": "No user responses found"}), 404

        user_answers = user_response.get("answers", {})
        user_response_id = user_response.get("response_id")

        # Fetch latest form response
        latest_form_response = form_responses_collection.find_one(sort=[("_id", -1)])
        if not latest_form_response:
            return jsonify({"error": "No form responses found"}), 404

        form_id = latest_form_response.get("form_id")
        quiz_questions = latest_form_response.get("questions", [])

        if not quiz_questions:
            return jsonify({"error": "No questions found"}), 404

        correct_answers = {q["question"]: q["correct_answer"] for q in quiz_questions}

        # Get form structure if form_id exists
        question_id_map = {}
        if form_id:
            try:
                form_data = service.forms().get(formId=form_id).execute()
                for item in form_data.get("items", []):
                    question_text = item.get("title", "")
                    question_id = item.get("questionItem", {}).get("question", {}).get("questionId", "")
                    if question_text and question_id:
                        question_id_map[question_id] = question_text
            except Exception as e:
                print(f"Warning: Could not fetch form structure: {str(e)}")

        # Calculate score and results
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

        user_response_collection.update_one(
            {"_id": user_response["_id"]},
            {"$set": evaluation_result}
        )

        return jsonify(evaluation_result)

    except Exception as e:
        error_details = traceback.format_exc()
        print(f"Error in evaluate_quiz: {error_details}")
        return jsonify({"error": str(e), "details": error_details}), 500
@app.route('/api/health', methods=['GET'])
def health_check():
    """Check if the API is running."""
    return jsonify({"status": "healthy"}), 200

if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
