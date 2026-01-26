#!/bin/bash

# Disclaude Quick Setup Script

echo "🚀 Setting up Disclaude..."
echo ""

# Check Python 3
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required but not installed."
    exit 1
fi

# Create virtual environment
echo "📦 Creating virtual environment..."
python3 -m venv venv

# Activate virtual environment
echo "🔌 Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo "📥 Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Check for .env file
if [ ! -f .env ]; then
    echo ""
    echo "⚠️  No .env file found!"
    echo "Creating from template..."
    cp .env.example .env
    echo ""
    echo "📝 Please edit .env and configure:"
    echo ""
    echo "1. Choose platform: PLATFORM=discord or PLATFORM=feishu"
    echo ""
    echo "2. Configure platform credentials:"
    echo "   For Discord:"
    echo "     - Set DISCORD_BOT_TOKEN"
    echo "   For Feishu/Lark:"
    echo "     - Set FEISHU_APP_ID and FEISHU_APP_SECRET"
    echo ""
    echo "3. Configure agent (choose one):"
    echo "   For Anthropic Claude:"
    echo "     - Set ANTHROPIC_API_KEY and CLAUDE_MODEL"
    echo "   For GLM (Zhipu AI):"
    echo "     - Set GLM_API_KEY, GLM_MODEL, and GLM_API_BASE_URL"
    echo ""
    echo "After editing, choose one of these options to run:"
    echo ""
    echo "Option 1: Use Falcon conda environment (recommended)"
    echo "  ./run_falcon.sh"
    echo ""
    echo "Option 2: Use system virtual environment"
    echo "  source venv/bin/activate && python main.py"
    echo ""
    echo "Option 3: Use Falcon conda directly"
    echo "  /Users/hs3180/anaconda/anaconda3/bin/conda run -n falcon python main.py"
else
    echo ""
    echo "✅ Setup complete!"
    echo "📝 Make sure .env is configured with your credentials"
    echo ""
    echo "To start the bot, choose one of these options:"
    echo ""
    echo "Option 1: Use Falcon conda environment (recommended)"
    echo "  ./run_falcon.sh"
    echo ""
    echo "Option 2: Use system virtual environment"
    echo "  source venv/bin/activate && python main.py"
    echo ""
    echo "Option 3: Use Falcon conda directly"
    echo "  /Users/hs3180/anaconda/anaconda3/bin/conda run -n falcon python main.py"
fi
