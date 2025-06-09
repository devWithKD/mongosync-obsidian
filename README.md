# Obsidian MongoDB Sync Plugin

A powerful Obsidian plugin that synchronizes your vault with MongoDB database, enabling real-time collaboration, backup, and cross-device synchronization.

## Features

- **Real-time Synchronization**: Uses MongoDB Change Streams for instant sync across devices
- **Conflict Resolution**: Smart handling of file conflicts with timestamp-based resolution
- **Selective Sync**: Configurable file exclusion patterns
- **Auto & Manual Sync**: Automatic background sync with manual sync options
- **Multi-Vault Support**: Each vault gets a unique ID for isolation
- **File Operations**: Handles create, modify, delete, and rename operations
- **Cross-Platform**: Works on desktop, mobile, and web versions of Obsidian

## Prerequisites

- MongoDB server (local or remote)
- Node.js and npm (for development)
- Obsidian v0.15.0 or higher

## Installation

### Method 1: Manual Installation (Recommended for Development)

1. Clone this repository into your vault's plugins folder:
```bash
cd /path/to/your/vault/.obsidian/plugins/
git clone https://github.com/yourusername/obsidian-mongodb-sync.git mongodb-sync
cd mongodb-sync
```

2. Install dependencies:
```bash
npm install
```

3. Build the plugin:
```bash
npm run build
```

4. Enable the plugin in Obsidian:
   - Open Settings → Community Plugins
   - Find "MongoDB Sync" and enable it

### Method 2: BRAT Installation

1. Install the BRAT plugin from Community Plugins
2. Add this repository URL: `https://github.com/yourusername/obsidian-mongodb-sync`
3. Enable the plugin

## MongoDB Setup

### Local MongoDB Setup

1. Install MongoDB:
```bash
# Ubuntu/Debian
sudo apt-get install mongodb

# macOS (with Homebrew)
brew install mongodb-community

# Windows - Download from MongoDB website
```

2. Start MongoDB:
```bash
# Linux/macOS
sudo systemctl start mongod
# or
mongod

# Windows
# Run as service or use MongoDB Compass
```

### MongoDB Atlas (Cloud) Setup

1. Create account at [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Create a cluster
3. Get connection string (mongodb+srv://...)
4. Whitelist your IP address
5. Create database user

### Docker Setup

```bash
# Run MongoDB in Docker
docker run -d \
  --name mongodb \
  -p 27017:27017 \
  -v mongodb_data:/data/db \
  mongo:latest

# With authentication
docker run -d \
  --name mongodb \
  -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=password123 \
  -v mongodb_data:/data/db \
  mongo:latest
```

## Configuration

1. Open Obsidian Settings → MongoDB Sync
2. Configure the following settings:

### Basic Settings

- **MongoDB URI**: Your MongoDB connection string
  - Local: `mongodb://localhost:27017`
  - Atlas: `mongodb+srv://username:password@cluster.mongodb.net/`
  - With auth: `mongodb://username:password@localhost:27017`

- **Database Name**: Name for your database (default: `obsidian_vault`)
- **Collection Name**: Name for the collection (default: `notes`)

### Sync Settings

- **Auto Sync**: Enable automatic synchronization
- **Sync Interval**: How often to sync (milliseconds, default: 5000)
- **Exclude Patterns**: Files/folders to exclude from sync

### Example Exclude Patterns
```
.obsidian/**
*.tmp
.git/**
.DS_Store
node_modules/**
```

## Usage

### First Time Setup

1. Configure MongoDB connection in settings
2. Click "Connect" to establish connection
3. The plugin will perform an initial sync
4. Your vault is now synchronized with MongoDB!

### Commands

Access these via Command Palette (Ctrl/Cmd + P):

- **MongoDB Sync: Manual sync**: Force immediate synchronization
- **MongoDB Sync: Connect**: Connect to MongoDB
- **MongoDB Sync: Disconnect**: Disconnect from MongoDB

### Status Icons

- 🔄 Sync in progress
- ✅ Connected and synchronized
- ❌ Connection error
- ⏸️ Disconnected

## How It Works

### Data Structure

Each note is stored in MongoDB as:
```javascript
{
  _id: ObjectId,
  path: "folder/note.md",
  content: "# Note Content\n\nThis is the note content...",
  mtime: 1699123456789,
  size: 1024,
  hash: "sha256_hash_of_content",
  vault_id: "unique-vault-identifier",
  created_at: ISODate("2024-01-01T12:00:00Z"),
  updated_at: ISODate("2024-01-01T12:30:00Z")
}
```

### Sync Process

1. **File Change Detection**: Uses Obsidian's file system events
2. **Hash Comparison**: SHA-256 hashes prevent unnecessary uploads
3. **Conflict Resolution**: Timestamp-based (latest modification wins)
4. **Change Streams**: Real-time updates from MongoDB to other clients
5. **Vault Isolation**: Each vault has unique ID to prevent cross-contamination

### Real-time Sync

The plugin uses MongoDB Change Streams to watch for changes:
- Filters out changes from the same vault to prevent loops
- Immediately applies remote changes to local files
- Handles create, update, delete, and rename operations

## Troubleshooting

### Common Issues

#### Connection Problems

**Error: "Failed to connect to MongoDB"**
- Check if MongoDB is running
- Verify connection string format
- Check network connectivity
- Ensure firewall allows connections

**Error: "Authentication failed"**
- Verify username/password in connection string
- Check database permissions
- For Atlas: ensure IP is whitelisted

#### Sync Issues

**Files not syncing**
- Check exclude patterns
- Verify file permissions
- Check MongoDB collection for errors
- Look at browser console (F12) for error messages

**Conflicts not resolving**
- Ensure system clocks are synchronized
- Check file modification times
- Manually resolve by choosing latest version

### Debugging

Enable debug mode by opening browser console (F12) and running:
```javascript
// Enable verbose logging
window.mongoSyncDebug = true;
```

Check logs in:
- Browser Console (F12 → Console)
- MongoDB logs
- Obsidian Developer Console

### Performance Optimization

For large vaults:
1. Increase sync interval
2. Use more specific exclude patterns
3. Consider MongoDB indexing
4. Monitor memory usage

## Advanced Configuration

### MongoDB Indexes

The plugin automatically creates these indexes:
```javascript
// Unique index for path and vault
db.notes.createIndex({ path: 1, vault_id: 1 }, { unique: true })

// Index for vault queries
db.notes.createIndex({ vault_id: 1 })

// Index for timestamp sorting
db.notes.createIndex({ updated_at: -1 })
```

### Custom Connection Options

For advanced MongoDB configuration, modify the connection in `main.ts`:
```typescript
this.client = new MongoClient(this.settings.mongoUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    // Add other options as needed
});
```

### Multiple Vaults

Each vault gets a unique identifier. To sync multiple vaults:
1. Configure each vault separately
2. Use same MongoDB database
3. Different `vault_id` ensures isolation

## API Reference

### Plugin Methods

```typescript
// Manual sync
await plugin.manualSync();

// Connect to MongoDB
await plugin.connectToMongoDB();

// Disconnect
await plugin.disconnectFromMongoDB();

// Upload specific file
await plugin.uploadFile(file);

// Check if file should be excluded
plugin.shouldExcludeFile(path);
```

### Settings Interface

```typescript
interface MongoSyncSettings {
    mongoUri: string;
    databaseName: string;
    collectionName: string;
    autoSync: boolean;
    syncInterval: number;
    excludePatterns: string[];
}
```

## Security Considerations

### Best Practices

1. **Use Authentication**: Always use MongoDB with authentication
2. **Network Security**: Use TLS/SSL for connections
3. **Access Control**: Limit database permissions
4. **Connection Strings**: Don't commit credentials to version control

### Environment Variables

For production, use environment variables:
```bash
export MONGO_URI="mongodb://username:password@host:port/database"
export MONGO_DB="obsidian_vault"
export MONGO_COLLECTION="notes"
```

Then reference in plugin settings or modify code to read from environment.

## Development

### Building from Source

```bash
# Clone repository
git clone https://github.com/yourusername/obsidian-mongodb-sync.git
cd obsidian-mongodb-sync

# Install dependencies
npm install

# Development build (with watching)
npm run dev

# Production build
npm run build
```

### Project Structure

```
obsidian-mongodb-sync/
├── main.ts              # Main plugin code
├── manifest.json        # Plugin manifest
├── package.json         # Dependencies
├── tsconfig.json        # TypeScript config
├── esbuild.config.mjs   # Build configuration
├── .gitignore          # Git ignore rules
└── README.md           # This file
```

### Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Add tests
5. Submit pull request

### Testing

```bash
# Run tests (when implemented)
npm test

# Lint code
npm run lint

# Type check
npm run type-check
```

## Roadmap

### Planned Features

- [ ] End-to-end encryption
- [ ] Selective file sync (choose specific folders)
- [ ] Sync history and versioning
- [ ] Conflict resolution UI
- [ ] Bulk operations optimization
- [ ] Plugin settings import/export
- [ ] Sync statistics dashboard
- [ ] Integration with MongoDB Atlas Search

### Version History

- **v1.0.0**: Initial release
  - Basic sync functionality
  - Real-time updates via Change Streams
  - File operations support
  - Settings UI

## Support

### Getting Help

- **Issues**: [GitHub Issues](https://github.com/yourusername/obsidian-mongodb-sync/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/obsidian-mongodb-sync/discussions)
- **Documentation**: This README and inline code comments

### Reporting Bugs

When reporting bugs, include:
1. Obsidian version
2. Plugin version
3. MongoDB version and setup
4. Steps to reproduce
5. Error messages/logs
6. Operating system

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- Inspired by Obsidian LiveSync Plugin
- MongoDB Node.js Driver team
- Obsidian plugin development community

---

**Note**: This plugin is not officially affiliated with Obsidian or MongoDB. Use at your own risk and always backup your data.
