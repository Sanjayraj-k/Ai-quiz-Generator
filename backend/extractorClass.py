import os
import PyPDF2
from docx import Document
from youtube_transcript_api import YouTubeTranscriptApi
import groq
from groq import Groq
import numpy as np
# from pydub import AudioSegment

# Hide the API key
client = Groq(api_key=os.getenv("GROQ_API_KEY", "xxx"))

class ContextExtractor:
    """
    A class to extract context from various sources: text, PDF, DOCX, YouTube, and audio.
    The extracted content is intended for use in a Retrieval-Augmented Generation (RAG) agent.
    Uses Whisper via Groq API for audio transcription.
    """

    def __init__(self):
        """
        Initialize the ContextExtractor with Groq API access.
        """
        pass

    def extract_from_text(self, file_path):
        """
        Extract text from a text file.

        :param file_path: Path to the text file (e.g., 'example.txt').
        :return: Extracted text as a string, or None if an error occurs.
        """
        try:
            with open(file_path, 'r', encoding='utf-8') as file:
                return file.read()
        except Exception as e:
            print(f"Error reading text file: {e}")
            return None

    def extract_from_pdf(self, file_path):
        """
        Extract text from a PDF file using PyPDF2.

        :param file_path: Path to the PDF file (e.g., 'example.pdf').
        :return: Extracted text as a string, or None if an error occurs.
        """
        try:
            with open(file_path, 'rb') as file:
                reader = PyPDF2.PdfReader(file)
                text = ''
                for page in reader.pages:
                    text += page.extract_text()
                return text
        except Exception as e:
            print(f"Error reading PDF file: {e}")
            return None

    def extract_from_doc(self, file_path):
        """
        Extract text from a DOCX file using python-docx.

        :param file_path: Path to the DOCX file (e.g., 'example.docx').
        :return: Extracted text as a string, or None if an error occurs.
        """
        try:
            doc = Document(file_path)
            text = ''
            for para in doc.paragraphs:
                text += para.text + '\n'
            return text
        except Exception as e:
            print(f"Error reading DOCX file: {e}")
            return None

    def extract_from_youtube(self, video_url):
        """
        Extract transcript from a YouTube video using youtube_transcript_api.

        :param video_url: URL of the YouTube video (e.g., 'https://www.youtube.com/watch?v=video_id').
        :return: Extracted transcript as a string, or None if an error occurs.
        """
        try:
            if 'youtu.be' in video_url:
                video_id = video_url.split('/')[-1].split('?')[0]
            else:
                video_id = video_url.split("v=")[1].split("&")[0]
            transcript_list = YouTubeTranscriptApi.get_transcript(video_id)
            transcript = " ".join([item['text'] for item in transcript_list])
            return transcript
        except Exception as e:
            print(f"Error retrieving YouTube transcript: {e}")
            return None

    # def extract_from_audio(self, file_path):
    #     """
    #     Transcribe audio to text using Whisper via Groq API.

    #     :param file_path: Path to the audio file (e.g., 'example.wav', 'example.mp3').
    #     :return: Transcribed text as a string, or None if an error occurs.
    #     """
    #     with open(file_path, "rb") as file:
    #         translation = client.audio.translations.create(
    #             file=(file_path, file.read()),
    #             model="whisper-large-v3",
    #         )
    #     return translation.text


    def extract(self, source):
        """
        Extract context from the given source, determining the type automatically.

        :param source: Path to the file (e.g., 'example.pdf') or YouTube URL (e.g., 'https://www.youtube.com/watch?v=video_id').
        :return: Extracted text as a string, or None if the source type is unsupported or an error occurs.
        """
        if source.startswith('http'):
            return self.extract_from_youtube(source)
        else:
            ext = os.path.splitext(source)[1].lower()
            if ext == '.txt':
                return self.extract_from_text(source)
            elif ext == '.pdf':
                return self.extract_from_pdf(source)
            elif ext in ['.doc', '.docx']:
                return self.extract_from_doc(source)
            else:
                print(f"Unsupported source type: {source}")
                return None
