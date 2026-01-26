"""
Main entry point for Disclaude.
Supports Discord or Feishu/Lark (one platform at a time).
"""
import sys
import asyncio

from config import Config
from agent_client import AgentClient
from discord_bot import DiscordBot, setup as setup_discord
from feishu_bot import FeishuBot, SessionManager


async def run_discord():
    """Run Discord bot."""
    print(f"Initializing Discord bot (prefix: {Config.DISCORD_COMMAND_PREFIX})...")
    
    # Get agent configuration
    agent_config = Config.get_agent_config()
    
    # Initialize agent client
    print(f"Connecting to agent (model: {agent_config['model']})...")
    agent = AgentClient(
        api_key=agent_config['api_key'],
        model=agent_config['model'],
        api_base_url=agent_config.get('api_base_url'),
        workspace=Config.AGENT_WORKSPACE,
    )
    print("Agent client initialized!")
    
    # Create Discord bot
    bot = DiscordBot(
        agent_client=agent,
        command_prefix=Config.DISCORD_COMMAND_PREFIX
    )
    
    # Load commands
    await setup_discord(bot)
    
    # Run bot
    print("Connecting to Discord...")
    await bot.start(Config.DISCORD_BOT_TOKEN)


async def run_feishu():
    """Run Feishu/Lark bot."""
    print(f"Initializing Feishu/Lark bot...")
    
    # Get agent configuration
    agent_config = Config.get_agent_config()
    
    # Initialize agent client
    print(f"Connecting to agent (model: {agent_config['model']})...")
    agent = AgentClient(
        api_key=agent_config['api_key'],
        model=agent_config['model'],
        api_base_url=agent_config.get('api_base_url'),
        workspace=Config.AGENT_WORKSPACE,
    )
    print("Agent client initialized!")
    
    # Initialize session manager
    session_manager = SessionManager(Config.SESSION_PERSISTENCE_PATH)
    
    # Create Feishu bot
    bot = FeishuBot(
        agent_client=agent,
        app_id=Config.FEISHU_APP_ID,
        app_secret=Config.FEISHU_APP_SECRET,
        session_manager=session_manager,
    )
    
    # Run bot (blocking)
    await bot.start()


async def main():
    """Run the selected platform."""
    print("=" * 50)
    print("  Disclaude - Agent Bot")
    print("=" * 50)
    print()
    
    # Validate configuration
    try:
        Config.validate()
    except ValueError as e:
        print(f"Configuration error:\n{e}")
        print("\nPlease create a .env file based on .env.example")
        sys.exit(1)
    
    # Get platform info
    platform_info = Config.get_platform_info()
    print(f"Platform: {platform_info}")
    print()
    
    # Run the selected platform
    if Config.PLATFORM == 'discord':
        await run_discord()
    elif Config.PLATFORM == 'feishu':
        await run_feishu()
    else:
        print(f"Unknown platform: {Config.PLATFORM}")
        sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nGoodbye!")
