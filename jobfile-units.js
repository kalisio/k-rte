import _ from 'lodash'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbUrl = process.env.DB_URL || 'mongodb://127.0.0.1:27017/rte'

export default {
  id: 'rte-units',
  store: 'memory',
  options: {
    workersLimit: 1,
    faultTolerant: true,
  },
  tasks: [{
    id: 'plants.csv',
    type: 'store',
    options: {
      store: 'fs'
    }
  }],
  hooks: {
    tasks: {
      after: {
        readCSV: { headers: true },
        convertToGeoJson: {
          latitude: 'lat',
          longitude: 'long'
        },
        updateMongoCollection: {
          collection: 'rte-units',
          filter: { 'properties.id': '<%= properties.id %>' },
          upsert: true,
          chunkSize: 256
        },
        clearData: {}
      }
    },
    jobs: {
      before: {
        createStores: [{
          id: 'memory'
        }, {
          id: 'fs', options: { path: __dirname }
        }],
        connectMongo: {
          url: dbUrl,
          // Required so that client is forwarded from job to tasks
          clientPath: 'taskTemplate.client'
        },
        createMongoCollection: {
          clientPath: 'taskTemplate.client',
          collection: 'rte-units',
          indices: [
            [{ 'properties.id': 1 }, { unique: true }], 
            { geometry: '2dsphere' }
          ]
        }
      },
      after: {
        disconnectMongo: {
          clientPath: 'taskTemplate.client'
        },
        removeStores: [ 'memory', 'fs' ]
      },
      error: {
        disconnectMongo: {
          clientPath: 'taskTemplate.client'
        },
        removeStores: [ 'memory', 'fs' ]
      }
    }
  }
}
