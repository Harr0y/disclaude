"""
Discord bot implementation.
"""
import discord
from discord.ext import commands
from typing import Optional, Any
from agent_client import AgentClient
from config import Config


class DiscordBot(commands.Bot):
    """Discord bot that connects to Claude Agent SDK."""
    
    def __init__(self, agent_client: AgentClient, command_prefix: str = "!"):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.members = True
        
        super().__init__(
            command_prefix=command_prefix,
            intents=intents,
            help_command=commands.DefaultHelpCommand()
        )
        
        self.agent_client = agent_client
        self.conversation_history = {}
    
    async def on_ready(self):
        """Called when bot is ready."""
        agent_config = Config.get_agent_config()
        print(f"Logged in as {self.user.name} ({self.user.id})")
        print(f"Model: {agent_config['model']}")
        print("------")
        print("Disclaude is online!")
    
    async def on_message(self, message: discord.Message):
        """Handle incoming messages."""
        # Ignore messages from bots
        if message.author.bot:
            return
        
        # Process commands first
        await self.process_commands(message)
        
        # Check if this is a direct mention
        if self.user in message.mentions:
            # Remove the bot mention from the message
            clean_message = message.content.replace(f"<@{self.user.id}>", "").strip()
            clean_message = clean_message.replace(f"<@!{self.user.id}>", "").strip()
            
            if clean_message:
                await self._process_agent_message(message, clean_message)
    
    async def _process_agent_message(self, message: discord.Message, prompt: str):
        """Process agent message with streaming response.
        
        Args:
            message: Discord message
            prompt: User prompt
        """
        user_id = str(message.author.id)
        
        # Send "Processing..." immediately
        async with message.channel.typing():
            # Get previous session (simple in-memory)
            session_id = self.conversation_history.get(user_id)
            
            # Accumulate response text
            response_text = ""
            
            try:
                # Stream agent response
                async for agent_message in self.agent_client.query_stream(prompt, session_id):
                    # Extract text from message
                    text = self._extract_text(agent_message)
                    if text:
                        response_text += text
                
                # Send final response
                if response_text:
                    # Note: For proper session management, you'd capture session_id
                    # from SDK hooks. For now, we use a simplified approach
                    await message.reply(response_text)
            
            except Exception as e:
                await message.reply(f"Error: {e}")
    
    def _extract_text(self, message: Any) -> str:
        """Extract text from agent message.
        
        Args:
            message: Message from agent
        
        Returns:
            Extracted text string
        """
        if hasattr(message, 'content'):
            content = message.content
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                parts = []
                for block in content:
                    if hasattr(block, 'text'):
                        parts.append(str(block.text))
                return "".join(parts)
        return ""
    
    async def on_command_error(self, ctx: commands.Context, error: Exception):
        """Handle command errors."""
        if isinstance(error, commands.CommandNotFound):
            return  # Ignore unknown commands
        elif isinstance(error, commands.MissingRequiredArgument):
            await ctx.send(f"Missing required argument: {error.param.name}")
        else:
            print(f"Error: {error}")
            await ctx.send("An error occurred while processing that command.")


class DiscordCommands(commands.Cog):
    """Commands cog for Discord."""
    
    def __init__(self, bot: DiscordBot):
        self.bot = bot
    
    @commands.command(name="ask")
    async def ask(self, ctx: commands.Context, *, question: str):
        """Ask the agent a question."""
        await self.bot._process_agent_message(ctx.message, question)
    
    @commands.command(name="reset")
    async def reset(self, ctx: commands.Context):
        """Reset conversation history."""
        user_id = str(ctx.author.id)
        if user_id in self.bot.conversation_history:
            del self.bot.conversation_history[user_id]
        await ctx.send("Conversation history cleared!")
    
    @commands.command(name="ping")
    async def ping(self, ctx: commands.Context):
        """Check if the bot is responsive."""
        latency = round(self.bot.latency * 1000)
        await ctx.send(f"Pong! 🏓 Latency: {latency}ms")
    
    @commands.command(name="info")
    async def info(self, ctx: commands.Context):
        """Show information about Disclaude."""
        agent_config = Config.get_agent_config()
        info = (
            f"**Disclaude** - Discord × Agent\n\n"
            f"Platform: Discord\n"
            f"Model: {agent_config['model']}\n\n"
            f"**Commands:**\n"
            f"`{self.bot.command_prefix}ask <question>` - Ask a question\n"
            f"`{self.bot.command_prefix}reset` - Clear conversation history\n"
            f"`{self.bot.command_prefix}ping` - Check bot latency\n"
            f"`{self.bot.command_prefix}info` - Show this info\n\n"
            f"**Tip:** You can also mention the bot directly to chat!"
        )
        await ctx.send(info)


async def setup(bot: DiscordBot):
    """Setup function for the cog."""
    await bot.add_cog(DiscordCommands(bot))
