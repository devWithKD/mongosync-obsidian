// main.ts
import {
	Plugin,
	TFile,
	TFolder,
	TAbstractFile,
	Notice,
	PluginSettingTab,
	App,
	Setting,
} from "obsidian";
import { MongoClient, Db, Collection, ChangeStream, ChangeStreamOptions } from "mongodb";

interface MongoSyncSettings {
	mongoUri: string;
	databaseName: string;
	collectionName: string;
	autoSync: boolean;
	syncInterval: number;
	excludePatterns: string[];
}

const DEFAULT_SETTINGS: MongoSyncSettings = {
	mongoUri: "mongodb://localhost:27017",
	databaseName: "obsidian_vault",
	collectionName: "notes",
	autoSync: true,
	syncInterval: 5000, // 5 seconds
	excludePatterns: [".obsidian/**", "*.tmp"],
};

interface NoteDocument {
	_id?: string;
	path: string;
	content: string;
	mtime: number;
	size: number;
	hash: string;
	vault_id: string;
	created_at: Date;
	updated_at: Date;
}

export default class MongoSyncPlugin extends Plugin {
	settings: MongoSyncSettings;
	client: MongoClient | null = null;
	db: Db | null = null;
	collection: Collection<NoteDocument> | null = null;
	changeStream: ChangeStream | null = null;
	syncInterval: NodeJS.Timeout | null = null;
	vaultId: string = "";
	isInitialized = false;

	async onload() {
		try {
			console.log("MongoDB Sync: Starting plugin initialization...");

			console.log("MongoDB Sync: Loading settings...");
			await this.loadSettings();

			// Generate or load vault ID
			console.log("MongoDB Sync: Getting vault ID...");
			this.vaultId = await this.getOrCreateVaultId();
			console.log("MongoDB Sync: Vault ID:", this.vaultId);

			// Add ribbon icon
			console.log("MongoDB Sync: Adding ribbon icon...");
			this.addRibbonIcon("sync", "MongoDB Sync", () => {
				this.manualSync();
			});

			// Add commands
			console.log("MongoDB Sync: Adding commands...");
			this.addCommand({
				id: "manual-sync",
				name: "Manual sync with MongoDB",
				callback: () => this.manualSync(),
			});

			this.addCommand({
				id: "connect-mongodb",
				name: "Connect to MongoDB",
				callback: () => this.connectToMongoDB(),
			});

			this.addCommand({
				id: "disconnect-mongodb",
				name: "Disconnect from MongoDB",
				callback: () => this.disconnectFromMongoDB(),
			});

			// Add settings tab
			console.log("MongoDB Sync: Adding settings tab...");
			this.addSettingTab(new MongoSyncSettingTab(this.app, this));

			// Initialize connection
			console.log(
				"MongoDB Sync: Checking MongoDB URI...",
				this.settings.mongoUri,
			);
			if (
				this.settings.mongoUri &&
				this.settings.mongoUri !== "mongodb://localhost:27017"
			) {
				console.log(
					"MongoDB Sync: Attempting to connect to MongoDB...",
				);
				await this.connectToMongoDB();
			} else {
				console.log(
					"MongoDB Sync: Using default MongoDB URI, skipping auto-connect",
				);
			}

			// Set up file watchers
			console.log("MongoDB Sync: Setting up file watchers...");
			this.registerEvent(
				this.app.vault.on("create", (file) => this.onFileCreate(file)),
			);

			this.registerEvent(
				this.app.vault.on("modify", (file) => this.onFileModify(file)),
			);

			this.registerEvent(
				this.app.vault.on("delete", (file) => this.onFileDelete(file)),
			);

			this.registerEvent(
				this.app.vault.on("rename", (file, oldPath) =>
					this.onFileRename(file, oldPath),
				),
			);

			console.log(
				"MongoDB Sync: Plugin initialization completed successfully!",
			);
			new Notice("MongoDB Sync plugin loaded successfully");
		} catch (error) {
			console.error("MongoDB Sync: Failed to initialize plugin:", error);
			new Notice(
				"MongoDB Sync: Failed to load plugin - check console for details",
			);
			throw error;
		}
	}

	async onunload() {
		await this.disconnectFromMongoDB();
		if (this.syncInterval) {
			clearInterval(this.syncInterval);
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async getOrCreateVaultId(): Promise<string> {
		const vaultConfig = await this.loadData();
		if (vaultConfig?.vaultId) {
			return vaultConfig.vaultId;
		}

		const newVaultId = this.generateUUID();
		await this.saveData({ ...vaultConfig, vaultId: newVaultId });
		return newVaultId;
	}

	generateUUID(): string {
		return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
			/[xy]/g,
			function (c) {
				const r = (Math.random() * 16) | 0;
				const v = c == "x" ? r : (r & 0x3) | 0x8;
				return v.toString(16);
			},
		);
	}

	async connectToMongoDB() {
		try {
			if (this.client) {
				await this.disconnectFromMongoDB();
			}

			new Notice("Connecting to MongoDB...");

			this.client = new MongoClient(this.settings.mongoUri);
			await this.client.connect();

			this.db = this.client.db(this.settings.databaseName);
			this.collection = this.db.collection<NoteDocument>(
				this.settings.collectionName,
			);

			// Create indexes
			await this.collection.createIndex(
				{ path: 1, vault_id: 1 },
				{ unique: true },
			);
			await this.collection.createIndex({ vault_id: 1 });
			await this.collection.createIndex({ updated_at: -1 });

			// Set up change stream for real-time sync
			await this.setupChangeStream();

			// Start auto-sync if enabled
			if (this.settings.autoSync) {
				this.startAutoSync();
			}

			this.isInitialized = true;
			new Notice("Connected to MongoDB successfully!");

			// Initial sync
			await this.initialSync();
		} catch (error) {
			console.error("Failed to connect to MongoDB:", error);
			new Notice(`Failed to connect to MongoDB: ${error.message}`);
		}
	}

	async disconnectFromMongoDB() {
		try {
			if (this.changeStream) {
				await this.changeStream.close();
				this.changeStream = null;
			}

			if (this.syncInterval) {
				clearInterval(this.syncInterval);
				this.syncInterval = null;
			}

			if (this.client) {
				await this.client.close();
				this.client = null;
				this.db = null;
				this.collection = null;
			}

			this.isInitialized = false;
			new Notice("Disconnected from MongoDB");
		} catch (error) {
			console.error("Error disconnecting from MongoDB:", error);
		}
	}

	async setupChangeStream() {
		if (!this.collection) return;

		try {
			const pipeline = [
				{
					$match: {
						"fullDocument.vault_id": { $ne: this.vaultId }, // Ignore changes from this vault
						operationType: {
							$in: ["insert", "update", "delete", "replace"],
						},
					},
				},
			];

			const options: ChangeStreamOptions = {
				fullDocument: "updateLookup",
			};

			this.changeStream = this.collection.watch(pipeline, options);

			this.changeStream.on("change", async (change) => {
				await this.handleRemoteChange(change);
			});

			this.changeStream.on("error", (error) => {
				console.error("Change stream error:", error);
				new Notice("MongoDB change stream error - check console");
			});
		} catch (error) {
			console.error("Failed to set up change stream:", error);
		}
	}

	async handleRemoteChange(change: any) {
		try {
			const { operationType, fullDocument } = change;

			if (!fullDocument) return;

			const localFile = this.app.vault.getAbstractFileByPath(
				fullDocument.path,
			);

			switch (operationType) {
				case "insert":
				case "update":
				case "replace":
					if (localFile instanceof TFile) {
						// Check if local file is newer
						const stat = await this.app.vault.adapter.stat(
							fullDocument.path,
						);
						if (stat && stat.mtime > fullDocument.mtime) {
							return; // Local file is newer, skip
						}
						// Update local file
						await this.app.vault.modify(
							localFile,
							fullDocument.content,
						);
					} else {
						// Create new file - ensure parent directories exist
						const parentPath = fullDocument.path.substring(
							0,
							fullDocument.path.lastIndexOf("/"),
						);
						if (
							parentPath &&
							!this.app.vault.getAbstractFileByPath(parentPath)
						) {
							// Create parent directories if they don't exist
							const pathParts = parentPath.split("/");
							let currentPath = "";
							for (const part of pathParts) {
								currentPath = currentPath
									? `${currentPath}/${part}`
									: part;
								if (
									!this.app.vault.getAbstractFileByPath(
										currentPath,
									)
								) {
									await this.app.vault.createFolder(
										currentPath,
									);
								}
							}
						}
						await this.app.vault.create(
							fullDocument.path,
							fullDocument.content,
						);
					}
					break;

				case "delete":
					if (localFile) {
						await this.app.vault.delete(localFile);
					}
					break;
			}
		} catch (error) {
			console.error("Error handling remote change:", error);
		}
	}

	startAutoSync() {
		if (this.syncInterval) {
			clearInterval(this.syncInterval);
		}

		this.syncInterval = setInterval(() => {
			this.manualSync();
		}, this.settings.syncInterval);
	}

	async initialSync() {
		if (!this.collection) return;

		try {
			new Notice("Performing initial sync...");

			// Get all remote documents for this vault
			const remoteDocs = await this.collection
				.find({ vault_id: this.vaultId })
				.toArray();
			const remoteDocMap = new Map(
				remoteDocs.map((doc) => [doc.path, doc]),
			);

			// Get all local files
			const localFiles = this.app.vault.getFiles();

			// Sync local files to remote
			for (const file of localFiles) {
				if (this.shouldExcludeFile(file.path)) continue;

				const remoteDoc = remoteDocMap.get(file.path);
				const fileHash = await this.getFileHash(file);

				if (!remoteDoc || remoteDoc.hash !== fileHash) {
					await this.uploadFile(file);
				}

				remoteDocMap.delete(file.path);
			}

			// Download remote files that don't exist locally
			for (const [path, doc] of remoteDocMap) {
				const localFile = this.app.vault.getAbstractFileByPath(path);
				if (!localFile) {
					await this.app.vault.create(path, doc.content);
				}
			}

			new Notice("Initial sync completed!");
		} catch (error) {
			console.error("Initial sync failed:", error);
			new Notice(`Initial sync failed: ${error.message}`);
		}
	}

	async manualSync() {
		if (!this.isInitialized) {
			new Notice("MongoDB not connected");
			return;
		}

		try {
			new Notice("Syncing with MongoDB...");
			await this.syncAllFiles();
			new Notice("Sync completed!");
		} catch (error) {
			console.error("Sync failed:", error);
			new Notice(`Sync failed: ${error.message}`);
		}
	}

	async syncAllFiles() {
		const files = this.app.vault.getFiles();

		for (const file of files) {
			if (this.shouldExcludeFile(file.path)) continue;
			await this.uploadFile(file);
		}
	}

	async uploadFile(file: TFile) {
		if (!this.collection) return;

		try {
			const content = await this.app.vault.read(file);
			const stat = await this.app.vault.adapter.stat(file.path);
			const hash = await this.getFileHash(file);

			const doc: NoteDocument = {
				path: file.path,
				content: content,
				mtime: stat?.mtime || Date.now(),
				size: stat?.size || 0,
				hash: hash,
				vault_id: this.vaultId,
				created_at: new Date(),
				updated_at: new Date(),
			};

			await this.collection.replaceOne(
				{ path: file.path, vault_id: this.vaultId },
				doc,
				{ upsert: true },
			);
		} catch (error) {
			console.error(`Failed to upload file ${file.path}:`, error);
		}
	}

	async deleteFile(path: string) {
		if (!this.collection) return;

		try {
			await this.collection.deleteOne({
				path: path,
				vault_id: this.vaultId,
			});
		} catch (error) {
			console.error(`Failed to delete file ${path}:`, error);
		}
	}

	async handleFolderRename(oldFolderPath: string, newFolderPath: string) {
		if (!this.collection) return;

		try {
			// Update all files in the renamed folder
			const oldPathPrefix = oldFolderPath.endsWith("/")
				? oldFolderPath
				: oldFolderPath + "/";
			const newPathPrefix = newFolderPath.endsWith("/")
				? newFolderPath
				: newFolderPath + "/";

			// Find all documents with paths starting with the old folder path
			const cursor = this.collection.find({
				vault_id: this.vaultId,
				path: {
					$regex: `^${oldPathPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
				},
			});

			const updateOperations: any[] = [];
			for await (const doc of cursor) {
				const newPath = doc.path.replace(oldPathPrefix, newPathPrefix);
				updateOperations.push({
					updateOne: {
						filter: { _id: doc._id },
						update: {
							$set: {
								path: newPath,
								updated_at: new Date(),
							},
						},
					},
				});
			}

			if (updateOperations.length > 0) {
				await this.collection.bulkWrite(updateOperations);
			}
		} catch (error) {
			console.error(
				`Failed to handle folder rename ${oldFolderPath} to ${newFolderPath}:`,
				error,
			);
		}
	}

	async renameFile(oldPath: string, newPath: string) {
		if (!this.collection) return;

		try {
			await this.collection.updateOne(
				{ path: oldPath, vault_id: this.vaultId },
				{
					$set: {
						path: newPath,
						updated_at: new Date(),
					},
				},
			);
		} catch (error) {
			console.error(
				`Failed to rename file ${oldPath} to ${newPath}:`,
				error,
			);
		}
	}

	async getFileHash(file: TFile): Promise<string> {
		const content = await this.app.vault.read(file);
		const encoder = new TextEncoder();
		const data = encoder.encode(content);
		const hashBuffer = await crypto.subtle.digest("SHA-256", data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
	}

	shouldExcludeFile(path: string): boolean {
		return this.settings.excludePatterns.some((pattern) => {
			const regex = new RegExp(
				pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*"),
			);
			return regex.test(path);
		});
	}

	// Event handlers
	async onFileCreate(file: TAbstractFile) {
		if (!(file instanceof TFile)) return; // Only handle files, not folders
		if (this.shouldExcludeFile(file.path)) return;
		await this.uploadFile(file);
	}

	async onFileModify(file: TAbstractFile) {
		if (!(file instanceof TFile)) return; // Only handle files, not folders
		if (this.shouldExcludeFile(file.path)) return;
		await this.uploadFile(file);
	}

	async onFileDelete(file: TAbstractFile) {
		if (this.shouldExcludeFile(file.path)) return;
		await this.deleteFile(file.path);
	}

	async onFileRename(file: TAbstractFile, oldPath: string) {
		if (
			this.shouldExcludeFile(file.path) &&
			this.shouldExcludeFile(oldPath)
		)
			return;
		if (file instanceof TFile) {
			await this.renameFile(oldPath, file.path);
		} else {
			// Handle folder renames by updating all files in the folder
			await this.handleFolderRename(oldPath, file.path);
		}
	}
}

class MongoSyncSettingTab extends PluginSettingTab {
	plugin: MongoSyncPlugin;

	constructor(app: App, plugin: MongoSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "MongoDB Sync Settings" });

		new Setting(containerEl)
			.setName("MongoDB URI")
			.setDesc(
				"MongoDB connection string (e.g., mongodb://localhost:27017)",
			)
			.addText((text) =>
				text
					.setPlaceholder("mongodb://localhost:27017")
					.setValue(this.plugin.settings.mongoUri)
					.onChange(async (value) => {
						this.plugin.settings.mongoUri = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Database Name")
			.setDesc("Name of the MongoDB database")
			.addText((text) =>
				text
					.setPlaceholder("obsidian_vault")
					.setValue(this.plugin.settings.databaseName)
					.onChange(async (value) => {
						this.plugin.settings.databaseName = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Collection Name")
			.setDesc("Name of the MongoDB collection")
			.addText((text) =>
				text
					.setPlaceholder("notes")
					.setValue(this.plugin.settings.collectionName)
					.onChange(async (value) => {
						this.plugin.settings.collectionName = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto Sync")
			.setDesc("Automatically sync files at regular intervals")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoSync)
					.onChange(async (value) => {
						this.plugin.settings.autoSync = value;
						await this.plugin.saveSettings();
						if (value && this.plugin.isInitialized) {
							this.plugin.startAutoSync();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Sync Interval (ms)")
			.setDesc("How often to sync automatically (milliseconds)")
			.addText((text) =>
				text
					.setPlaceholder("5000")
					.setValue(this.plugin.settings.syncInterval.toString())
					.onChange(async (value) => {
						const interval = parseInt(value);
						if (!isNaN(interval) && interval > 0) {
							this.plugin.settings.syncInterval = interval;
							await this.plugin.saveSettings();
							if (
								this.plugin.settings.autoSync &&
								this.plugin.isInitialized
							) {
								this.plugin.startAutoSync();
							}
						}
					}),
			);

		new Setting(containerEl)
			.setName("Exclude Patterns")
			.setDesc("File patterns to exclude from sync (one per line)")
			.addTextArea((text) =>
				text
					.setPlaceholder(".obsidian/**\n*.tmp\n.git/**")
					.setValue(this.plugin.settings.excludePatterns.join("\n"))
					.onChange(async (value) => {
						this.plugin.settings.excludePatterns = value
							.split("\n")
							.map((line) => line.trim())
							.filter((line) => line.length > 0);
						await this.plugin.saveSettings();
					}),
			);

		// Connection status and controls
		containerEl.createEl("h3", { text: "Connection" });

		const statusEl = containerEl.createEl("p");
		statusEl.setText(
			`Status: ${this.plugin.isInitialized ? "Connected" : "Disconnected"}`,
		);

		new Setting(containerEl)
			.setName("Connect/Disconnect")
			.setDesc("Manually connect or disconnect from MongoDB")
			.addButton((button) =>
				button
					.setButtonText(
						this.plugin.isInitialized ? "Disconnect" : "Connect",
					)
					.onClick(async () => {
						if (this.plugin.isInitialized) {
							await this.plugin.disconnectFromMongoDB();
						} else {
							await this.plugin.connectToMongoDB();
						}
						this.display(); // Refresh the settings display
					}),
			);

		new Setting(containerEl)
			.setName("Manual Sync")
			.setDesc("Force a manual sync with MongoDB")
			.addButton((button) =>
				button
					.setButtonText("Sync Now")
					.onClick(() => this.plugin.manualSync()),
			);
	}
}
