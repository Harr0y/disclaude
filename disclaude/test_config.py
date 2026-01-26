#!/usr/bin/env python3
"""
Test script to validate Disclaude configuration.
"""
import sys
import os
import importlib.util

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def test_imports():
    """Test if required packages are installed."""
    print("🧪 Testing package imports...")
    print("-" * 50)
    
    packages = {
        'anthropic': 'Anthropic SDK',
        'lark_oapi': 'Lark/Feishu SDK',
        'discord': 'Discord SDK',
        'dotenv': 'python-dotenv',
    }
    
    missing = []
    for module, name in packages.items():
        available = importlib.util.find_spec(module) is not None
        status = "✅" if available else "❌"
        print(f"{status} {name}")
        if not available:
            missing.append(name)
    
    print()
    return missing


def test_config():
    """Test configuration."""
    print("🔧 Testing Configuration")
    print("=" * 50)
    
    try:
        from config import Config
        print("✅ Config module loaded")
    except Exception as e:
        print(f"❌ Failed to load config: {e}")
        return False
    
    # Platform
    print(f"\n📱 Platform:")
    print(f"   Platform: {Config.PLATFORM}")
    
    if Config.PLATFORM == 'discord':
        print(f"\n🎮 Discord Configuration:")
        if Config.DISCORD_BOT_TOKEN:
            print(f"   ✅ Bot Token: {Config.DISCORD_BOT_TOKEN[:8]}...{Config.DISCORD_BOT_TOKEN[-4:]}")
        else:
            print(f"   ❌ Bot Token: NOT SET")
        print(f"   ✅ Prefix: {Config.DISCORD_COMMAND_PREFIX}")
    
    elif Config.PLATFORM == 'feishu':
        print(f"\n🐦 Feishu/Lark Configuration:")
        if Config.FEISHU_APP_ID:
            print(f"   ✅ App ID: {Config.FEISHU_APP_ID}")
        else:
            print(f"   ❌ App ID: NOT SET")
        if Config.FEISHU_APP_SECRET:
            print(f"   ✅ App Secret: {Config.FEISHU_APP_SECRET[:8]}...{Config.FEISHU_APP_SECRET[-4:]}")
        else:
            print(f"   ❌ App Secret: NOT SET")
    
    # Agent configuration
    print(f"\n🤖 Agent Configuration:")
    agent_config = Config.get_agent_config()
    print(f"   ✅ API Key: {agent_config['api_key'][:20]}...{agent_config['api_key'][-10:]}")
    print(f"   ✅ Model: {agent_config['model']}")
    if agent_config.get('api_base_url'):
        print(f"   ✅ API Base URL: {agent_config['api_base_url']}")
    else:
        print(f"   ℹ️  API Base URL: Not set (using Anthropic default)")
    
    print(f"\n📁 Workspace:")
    print(f"   ✅ Workspace: {Config.AGENT_WORKSPACE}")
    print(f"   ✅ Sessions: {Config.SESSION_PERSISTENCE_PATH}")
    
    # Validate
    print(f"\n✨ Validating Configuration:")
    try:
        Config.validate()
        print("   ✅ Configuration is valid!")
    except ValueError as e:
        print(f"   ❌ Configuration errors:\n{e}")
        return False
    
    return True


async def test_glm_connection():
    """Test GLM API connection."""
    print(f"\n🌐 Testing API Connection")
    print("-" * 50)
    
    from config import Config
    from agent_client import AgentClient
    
    agent_config = Config.get_agent_config()
    
    print(f"   Model: {agent_config['model']}")
    if agent_config.get('api_base_url'):
        print(f"   API URL: {agent_config['api_base_url']}")
        print(f"   Provider: GLM (Zhipu AI)")
    else:
        print(f"   API URL: Anthropic default")
        print(f"   Provider: Anthropic Claude")
    
    try:
        client = AgentClient(
            api_key=agent_config['api_key'],
            model=agent_config['model'],
            api_base_url=agent_config.get('api_base_url'),
            workspace=Config.AGENT_WORKSPACE,
        )
        
        # Simple test query
        print("   🔄 Sending test query...")
        response_text = ""
        async for message in client.query_stream("Hello, respond with just 'OK'"):
            text = client._extract_text(message)
            if text:
                response_text += text
        
        if 'OK' in response_text:
            print(f"   ✅ API connection successful!")
            print(f"   📄 Response: {response_text[:100]}")
            return True
        else:
            print(f"   ⚠️  Got response but unexpected: {response_text[:100]}")
            return False
    
    except Exception as e:
        print(f"   ❌ API connection failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_feishu_connection():
    """Test Feishu/Lark API connection."""
    print(f"\n🐦 Testing Feishu/Lark Connection")
    print("-" * 50)
    
    from config import Config
    
    if Config.PLATFORM != 'feishu':
        print("ℹ️  Feishu not enabled in config")
        return True
    
    print(f"   App ID: {Config.FEISHU_APP_ID}")
    
    try:
        import aiohttp
        import asyncio
        
        # Get tenant access token
        url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
        payload = {
            "app_id": Config.FEISHU_APP_ID,
            "app_secret": Config.FEISHU_APP_SECRET
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload) as resp:
                result = await resp.json()
                
                if result.get("code") == 0:
                    token = result.get("tenant_access_token")
                    print(f"   ✅ Feishu API connection successful!")
                    print(f"   🔑 Token: {token[:20]}...{token[-10:]}")
                    return True
                else:
                    print(f"   ❌ Feishu API error: {result}")
                    return False
    
    except Exception as e:
        print(f"   ❌ Feishu connection failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def main():
    """Main test function."""
    print("=" * 50)
    print("  Disclaude Configuration Test")
    print("=" * 50)
    print()
    
    # Test imports
    missing_packages = test_imports()
    if missing_packages:
        print(f"\n❌ Missing packages: {', '.join(missing_packages)}")
        print("   Run: pip install -r requirements.txt")
        return False
    
    print()
    
    # Test config
    if not test_config():
        return False
    
    # Test connections
    api_ok = await test_glm_connection()
    feishu_ok = await test_feishu_connection()
    
    # Summary
    print("\n" + "=" * 50)
    print("  Test Summary")
    print("=" * 50)
    print(f"  Imports: ✅")
    print(f"  Config: ✅")
    print(f"  API: {'✅' if api_ok else '❌'}")
    print(f"  Feishu API: {'✅' if feishu_ok else '❌'}")
    print("=" * 50)
    
    if api_ok and feishu_ok:
        print("\n✅ All tests passed! Configuration looks good.")
        print("\nTo start bot:")
        print("  source venv/bin/activate")
        print("  python main.py")
        return True
    else:
        print("\n❌ Some tests failed. Please check errors above.")
        return False


if __name__ == "__main__":
    import asyncio
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
