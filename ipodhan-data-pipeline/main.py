"""
IPODhan Data Pipeline Main Entry Point
"""
import os
import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def main():
    """Main entry point for the data pipeline"""
    print("IPODhan Data Pipeline Starting...")
    print(f"Python Version: {sys.version}")
    print(f"Environment: {os.getenv('ENVIRONMENT', 'development')}")

    # TODO: Initialize scrapers and schedulers
    pass

if __name__ == "__main__":
    main()