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
app = Flask(__name__)
CORS(app)

# MongoDB Configuration
MONGO_URI = "mongodb://localhost:27017"  # Change if using cloud DB
client = MongoClient(MONGO_URI)
db = client["Question"]  # Database Name
quiz_collection = db["listofquestion"]  

# API Keys & Config
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "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")
LANGCHAIN_API_KEY = os.environ.get("LANGCHAIN_API_KEY", "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")
LANGCHAIN_PROJECT = os.environ.get("LANGCHAIN_PROJECT", "quiz-generator")
UPLOAD_FOLDER = tempfile.mkdtemp()
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

client = Client(api_key=LANGCHAIN_API_KEY)
tracer = LangChainTracer(project_name=LANGCHAIN_PROJECT)
load_dotenv()

# MongoDB Configuration

form_responses_collection = db["form_responses"]
user_responses_collection = db["user_responses"]

# Google Forms API Authentication
SCOPES = [
    "https://www.googleapis.com/auth/forms.body",
    "https://www.googleapis.com/auth/forms.responses.readonly"
]
SERVICE_ACCOUNT_FILE = os.getenv("SERVICE_ACCOUNT_FILE", "service-account.json")

creds = service_account.Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=SCOPES)
service = build("forms", "v1", credentials=creds)

llm = ChatGroq(
    temperature=0.2,
    model_name="llama-3.3-70b-versatile",
    groq_api_key=GROQ_API_KEY,
)

embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

class GraphState(TypedDict):
    retriever: MultiQueryRetriever
    content: str
    difficulty: str
    num_questions: int
    questions: List[Dict]

def process_document(file_path, file_type):
    """Loads the document, splits it into chunks, and creates a retriever."""
    if file_type == 'pdf':
        loader = PyPDFLoader(file_path)
    elif file_type == 'docx':
        loader = Docx2txtLoader(file_path)
    else:
        loader = TextLoader(file_path)

    documents = loader.load()

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=2000,
        chunk_overlap=200
    )
    chunks = text_splitter.split_documents(documents)

    vectorstore = FAISS.from_documents(chunks, embeddings)
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
            "quiz": result["questions"]
        })
   
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)


@app.route('/create-google-form', methods=['GET'])
def create_google_form():
    """Fetch the quiz using quiz_id, create a Google Form, and store the response."""
    try:
        quiz_id = request.args.get("quiz_id")
        if not quiz_id:
            return jsonify({"error": "Missing quiz_id"}), 400

        quiz = quiz_collection.find_one({"_id": ObjectId(quiz_id)})
        if not quiz or not quiz.get("quiz"):
            return jsonify({"error": "Quiz not found or empty"}), 404

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

        quiz_collection.update_one({"_id": ObjectId(quiz_id)}, {"$set": {"google_form_link": form_link}})
        form_responses_collection.insert_one({
            "quiz_id": ObjectId(quiz_id),
            "form_id": form_id,
            "title": "Auto-Generated Quiz",
            "questions": questions,
            "google_form_link": form_link
        })

        return jsonify({"message": "Form created successfully", "google_form_link": form_link})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """Check if the API is running."""
    return jsonify({"status": "healthy"}), 200

if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))