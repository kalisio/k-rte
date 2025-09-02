import _ from 'lodash'
import moment from 'moment'
import path from 'path'
import { fileURLToPath } from 'url'
import winston from 'winston'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_URL = process.env.DB_URL || 'mongodb://127.0.0.1:27017/rte'

// FIXME: now we only have information about nuclear plant/reactors
export default {
  id: 'rte-units',
  store: 'memory',
  options: {
    workersLimit: 1,
    faultTolerant: true,
  },
  tasks: [{
    id: 'reactors.csv',
    type: 'store',
    options: {
      store: 'fs'
    }
  }],
  hooks: {
    tasks: {
      after: {
        readCSV: {
          header: true
        },
        apply: {
          function: (item) => {
            const plants = _.get(item, 'plants', [])
            delete item.plants
            const units = _.get(item, 'data', [])
            _.forEach(units, (unit) => {
              // Find owing plant to get location and other useful information
              const plant = _.find(plants, { id: unit.plantId })
              if (plant) {
                _.merge(unit, _.omit(plant, ['id', 'name']))
              }
              // Convert some properties
              _.forOwn(unit, (value, key) => {
                if (key.endsWith('_MW')) unit[key] = _.toNumber(unit[key])
                if (key.endsWith('Date')) unit[key] = moment.utc(unit[key], 'DD/MM/YYYY').toDate()
              })
            })
            return item
          }
        },
        log: (logger, item) => logger.info(`${item.data.length} observations found`),
        convertToGeoJson: {
          latitude: 'lat',
          longitude: 'long'
        },
        updateMongoCollection: {
          collection: 'rte-units',
          filter: { 'properties.eicCode': '<%= properties.eicCode %>' },
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
          url: DB_URL,
          // Required so that client is forwarded from job to tasks
          clientPath: 'taskTemplate.client'
        },
        createLogger: {
          loggerPath: 'taskTemplate.logger',
          Console: {
            format: winston.format.printf(log =>
              winston.format.colorize().colorize(
                log.level,
                `${log.level}: ${log.message}`
              )
            ),
            level: 'verbose'
          }
        },
        createMongoCollection: {
          clientPath: 'taskTemplate.client',
          collection: 'rte-units',
          indices: [
            [{ 'properties.eicCode': 1 }, { unique: true }], 
            { geometry: '2dsphere' }
          ]
        },
        readCSV: {
          key: 'plants.csv',
          store: 'fs',
          header: true,
          dataPath: 'data.taskTemplate.plants'
        }
      },
      after: {
        disconnectMongo: {
          clientPath: 'taskTemplate.client'
        },
        removeLogger: {
          loggerPath: 'taskTemplate.logger'
        },
        removeStores: [ 'memory', 'fs' ]
      },
      error: {
        disconnectMongo: {
          clientPath: 'taskTemplate.client'
        },
        removeLogger: {
          loggerPath: 'taskTemplate.logger'
        },
        removeStores: [ 'memory', 'fs' ]
      }
    }
  }
}
