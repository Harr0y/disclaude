#!/bin/bash

# Run Disclaude with Falcon conda environment

# Path to conda
CONDA_PATH="/Users/hs3180/anaconda/anaconda3/bin/conda"
ENV_NAME="falcon"

# Check if conda environment exists
if [ ! -d "$HOME/anaconda/anaconda3/envs/$ENV_NAME" ]; then
    echo "❌ Conda environment '$ENV_NAME' not found!"
    echo "Please create it first:"
    echo "  conda env create -f /Users/hs3180/Documents/Falcon/environment.yml"
    exit 1
fi

# Run with falcon environment
echo "🚀 Starting Disclaude with Falcon environment..."
echo "Environment: $ENV_NAME"
echo "Python: 3.12"
echo ""

$CONDA_PATH run -n $ENV_NAME python /Users/hs3180/clawd/disclaude/main.py
