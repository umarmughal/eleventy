const isPlainObject = require("lodash/isPlainObject");
const DependencyGraph = require("dependency-graph").DepGraph;
const TemplateCollection = require("./TemplateCollection");
const eleventyConfig = require("./EleventyConfig");
const debug = require("debug")("Eleventy:TemplateMap");
const debugDev = require("debug")("Dev:Eleventy:TemplateMap");

class TemplateMap {
  constructor() {
    this.map = [];
    this.graph = new DependencyGraph();
    this.collectionsData = null;
    this.cached = false;
    this.configCollections = null;
  }

  async add(template) {
    for (let map of await template.getMappedTemplates()) {
      this.map.push(map);
    }
  }

  getMap() {
    return this.map;
  }

  get collection() {
    if (!this._collection) {
      this._collection = new TemplateCollection();
    }
    return this._collection;
  }

  getMappedDependencies() {
    let graph = new DependencyGraph();
    let tagPrefix = "___TAG___";

    graph.addNode(tagPrefix + "all");

    // Add tags in data
    for (let entry of this.map) {
      graph.addNode(entry.inputPath);
      if (entry.data.tags) {
        let tags = entry.data.tags;
        for (let tag of tags) {
          graph.addNode(tagPrefix + tag);
        }
      }
    }

    // Add tags from named user config collections
    for (let tag of this.getUserConfigCollectionNames()) {
      graph.addNode(tagPrefix + tag);
    }

    for (let entry of this.map) {
      // collections.all
      graph.addDependency(tagPrefix + "all", entry.inputPath);

      // collections.tagName
      if (entry.data.tags) {
        let tags = entry.data.tags;
        for (let tag of tags) {
          graph.addDependency(tagPrefix + tag, entry.inputPath);
        }
      }

      // Pagination data
      // TODO add support for declarative dependencies in front matter (similar to pagination above)
      if (entry.data.pagination && entry.data.pagination.data) {
        if (entry.data.pagination.data.startsWith("collections.")) {
          let tag = entry.data.pagination.data.substr("collections.".length);
          graph.addDependency(entry.inputPath, tagPrefix + tag);
        }
      }
    }

    return graph.overallOrder();
  }

  async cache() {
    debug("Caching collections objects.");
    this.collectionsData = {};

    for (let entry of this.map) {
      entry.data.collections = this.collectionsData;
    }

    // console.log( ">>> START" );
    let dependencyMap = this.getMappedDependencies();
    let tagPrefix = "___TAG___";
    for (let depEntry of dependencyMap) {
      if (depEntry.startsWith(tagPrefix)) {
        let tagName = depEntry.substr(tagPrefix.length);
        if (this.isUserConfigCollectionName(tagName)) {
          // async
          // console.log( "user config collection for", tagName );
          this.collectionsData[tagName] = await this.getUserConfigCollection(
            tagName
          );
        } else {
          // console.log( "tagged collection for ", tagName );
          this.collectionsData[tagName] = this.getTaggedCollection(tagName);
        }
      } else {
        // console.log( depEntry, "Input file" );
        let map = this._getMapEntryForInputPath(depEntry);
        map._pages = await map.template.getTemplates(map.data);
        let counter = 0;
        for (let page of map._pages) {
          // TODO do we need these in map entries?
          if (!map.outputPath) {
            map.outputPath = page.outputPath;
          }
          if (!map.url) {
            map.url = page.url;
          }
          if (
            counter === 0 ||
            (map.data.pagination &&
              map.data.pagination.addAllPagesToCollections)
          ) {
            this.collection.add(page);
          }
          counter++;
        }
      }
    }

    // TODO running this once at the end might be a problem
    // if user config collections needs outputPaths
    // await this.populateCollectionsWithOutputPaths(this.collectionsData);
    // console.log( ">>> END" );

    await this.populateContentDataInMap();
    this.populateCollectionsWithContent();
    this.cached = true;
  }

  _testGetMapEntryForPath(inputPath) {
    for (let j = 0, k = this.map.length; j < k; j++) {
      // inputPath should be unique (even with pagination?)
      if (this.map[j].inputPath === inputPath) {
        return this.map[j];
      }
    }
  }

  _getMapEntryForInputPath(inputPath) {
    for (let map of this.map) {
      if (map.inputPath === inputPath) {
        return map;
      }
    }
  }

  async populateContentDataInMap() {
    for (let map of this.map) {
      for (let page of map._pages) {
        let content = await map.template.getTemplateMapContent(page);
        page.templateContent = content;

        // TODO Do we need this?
        if (!map.templateContent) {
          map.templateContent = content;
        }
      }
      debugDev(
        "Added this.map[...].templateContent, outputPath, et al for one map entry"
      );
    }
  }

  _testGetAllTags() {
    let allTags = {};
    for (let map of this.map) {
      let tags = map.data.tags;
      if (Array.isArray(tags)) {
        for (let tag of tags) {
          allTags[tag] = true;
        }
        // This branch should no longer be necessary per TemplateData.cleanupData
      } else if (tags) {
        allTags[tags] = true;
      }
    }
    return Object.keys(allTags);
  }

  getTaggedCollection(tag) {
    let result;
    if (!tag || tag === "all") {
      result = this.collection.getAllSorted();
    } else {
      result = this.collection.getFilteredByTag(tag);
    }
    debug(`Collection: collections.${tag || "all"} size: ${result.length}`);

    return result;
  }

  async _testGetTaggedCollectionsData() {
    let collections = {};
    collections.all = this.collection.getAllSorted();
    debug(`Collection: collections.all size: ${collections.all.length}`);

    let tags = this._testGetAllTags();
    for (let tag of tags) {
      collections[tag] = this.collection.getFilteredByTag(tag);
      debug(`Collection: collections.${tag} size: ${collections[tag].length}`);
    }
    return collections;
  }

  setUserConfigCollections(configCollections) {
    return (this.configCollections = configCollections);
  }

  isUserConfigCollectionName(name) {
    let collections = this.configCollections || eleventyConfig.getCollections();
    return !!collections[name];
  }

  getUserConfigCollectionNames() {
    return Object.keys(
      this.configCollections || eleventyConfig.getCollections()
    );
  }

  async getUserConfigCollection(name) {
    let configCollections =
      this.configCollections || eleventyConfig.getCollections();
    // CHANGE this works with async now
    let result = await configCollections[name](this.collection);

    debug(`Collection: collections.${name} size: ${result.length}`);
    return result;
  }

  async _testGetUserConfigCollectionsData() {
    let collections = {};
    let configCollections =
      this.configCollections || eleventyConfig.getCollections();

    for (let name in configCollections) {
      collections[name] = configCollections[name](this.collection);

      debug(
        `Collection: collections.${name} size: ${collections[name].length}`
      );
    }

    return collections;
  }

  async _testGetAllCollectionsData() {
    let collections = {};
    let taggedCollections = await this._testGetTaggedCollectionsData();
    Object.assign(collections, taggedCollections);

    let userConfigCollections = await this._testGetUserConfigCollectionsData();
    Object.assign(collections, userConfigCollections);

    return collections;
  }

  getMapEntryFromInputPath(inputPath) {
    for (let entry of this.map) {
      if (entry.inputPath === inputPath) {
        return entry;
      }
    }
  }

  populateCollectionsWithContent() {
    for (let collectionName in this.collectionsData) {
      if (!Array.isArray(this.collectionsData[collectionName])) {
        continue;
      }

      for (let item of this.collectionsData[collectionName]) {
        if (!isPlainObject(item) || !("inputPath" in item)) {
          continue;
        }

        let entry = this.getMapEntryFromInputPath(item.inputPath);
        let index = entry.pageNumber || 0;
        item.templateContent = entry._pages[index].templateContent;
      }
    }
  }

  async getCollectionsData() {
    if (!this.cached) {
      await this.cache();
    }

    return this.collectionsData;
  }
}

module.exports = TemplateMap;
