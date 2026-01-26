"""
Configuration management for Disclaude.
"""
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class Config:
    """Application configuration."""
    
    # Platform selection (one of: discord, feishu)
    PLATFORM = os.getenv('PLATFORM', 'discord').lower()
    
    # Discord configuration
    DISCORD_BOT_TOKEN = os.getenv('DISCORD_BOT_TOKEN')
    DISCORD_COMMAND_PREFIX = os.getenv('DISCORD_COMMAND_PREFIX', '!')
    
    # Feishu/Lark configuration
    FEISHU_APP_ID = os.getenv('FEISHU_APP_ID')
    FEISHU_APP_SECRET = os.getenv('FEISHU_APP_SECRET')
    
    # Claude configuration
    ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')
    CLAUDE_MODEL = os.getenv('CLAUDE_MODEL', 'claude-3-5-sonnet-20241022')
    
    # GLM configuration
    GLM_API_KEY = os.getenv('GLM_API_KEY')
    GLM_MODEL = os.getenv('GLM_MODEL', 'glm-4.7')
    GLM_API_BASE_URL = os.getenv('GLM_API_BASE_URL', 'https://open.bigmodel.cn/api/anthropic')
    
    # Agent configuration
    AGENT_WORKSPACE = os.getenv('AGENT_WORKSPACE', './workspace')
    SESSION_PERSISTENCE_PATH = os.getenv('SESSION_PERSISTENCE_PATH', './sessions.json')
    
    @classmethod
    def get_agent_config(cls) -> dict:
        """Get agent configuration based on available API keys.
        
        Returns:
            Dictionary with api_key, model, and optional api_base_url
        """
        # Prefer GLM if configured
        if cls.GLM_API_KEY:
            return {
                'api_key': cls.GLM_API_KEY,
                'model': cls.GLM_MODEL,
                'api_base_url': cls.GLM_API_BASE_URL,
            }
        
        # Fallback to Anthropic
        if cls.ANTHROPIC_API_KEY:
            return {
                'api_key': cls.ANTHROPIC_API_KEY,
                'model': cls.CLAUDE_MODEL,
                'api_base_url': None,
            }
        
        raise ValueError("No API key configured. Set GLM_API_KEY or ANTHROPIC_API_KEY")
    
    @classmethod
    def validate(cls):
        """Validate required configuration."""
        errors = []
        
        # Validate platform
        if cls.PLATFORM not in ('discord', 'feishu'):
            errors.append(f"PLATFORM must be 'discord' or 'feishu', got: {cls.PLATFORM}")
        
        # Validate platform-specific configuration
        if cls.PLATFORM == 'discord':
            if not cls.DISCORD_BOT_TOKEN:
                errors.append("DISCORD_BOT_TOKEN is required when PLATFORM=discord")
        elif cls.PLATFORM == 'feishu':
            if not cls.FEISHU_APP_ID:
                errors.append("FEISHU_APP_ID is required when PLATFORM=feishu")
            if not cls.FEISHU_APP_SECRET:
                errors.append("FEISHU_APP_SECRET is required when PLATFORM=feishu")
        
        # Validate agent configuration
        if not cls.GLM_API_KEY and not cls.ANTHROPIC_API_KEY:
            errors.append("At least one API key is required: GLM_API_KEY or ANTHROPIC_API_KEY")
        
        if errors:
            raise ValueError("Configuration errors:\n" + "\n".join(f"  - {e}" for e in errors))
        
        return True
    
    @classmethod
    def get_platform_info(cls) -> str:
        """Get platform info for display.
        
        Returns:
            String describing the platform and model
        """
        agent_config = cls.get_agent_config()
        model = agent_config['model']
        
        if cls.PLATFORM == 'discord':
            return f"Discord bot with {model}"
        else:
            return f"Feishu/Lark bot with {model}"
