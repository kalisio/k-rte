import _ from 'lodash'
import moment from 'moment'

const dbUrl = process.env.DB_URL || 'mongodb://127.0.0.1:27017/rte'
const ttl = +process.env.TTL || (7 * 24 * 60 * 60)  // duration in seconds
const typeFilter = process.env.PRODUCTION_TYPE_FILTER ? process.env.PRODUCTION_TYPE_FILTER.split(',') : ''

export default {
  id: 'rte-generation',
  store: 'memory',
  options: {
    workersLimit: 1
  },
  tasks: [{
    id: 'generation',
    type: 'http',
    options: {
      url: 'https://digital.iservices.rte-france.com/open_api/actual_generation/v1/actual_generations_per_unit',
      oauth: {
        url: 'https://digital.iservices.rte-france.com/token/oauth',
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        method: 'client_secret_basic'
      },
      // It seems that we cannot request less than two day
      start_date: moment.utc().subtract(2, 'days').format(),
      end_date: moment.utc().format()
    }
  }],
  hooks: {
    tasks: {
      before: {
        OAuth: {},
        createMongoAggregation: {
          dataPath: 'data.mostRecentData',
          collection: 'rte-generation',
          pipeline: [
            { $sort: { 'properties.eic_code': 1, time: 1 } },
            {
              $group:
                {
                  _id: "$properties.eic_code",
                  time: { $last: "$time" }
                }
            }
          ],
          allowDiskUse: true
        }
      },
      after: {
        readJson: {},
        apply: {
          function: (item) => {
            const units = _.get(item, 'units', [])
            console.log('Seeking generation data for ' + units.length + ' units')
            delete item.units
            const mostRecentData = _.get(item, 'mostRecentData', [])
            let generation = _.get(item, 'data.actual_generations_per_unit', [])
            // Filter required production types
            if (typeFilter) {
              generation = generation.filter(data => typeFilter.includes(_.get(data, 'unit.production_type')))
            }
            let features = []
            _.forEach(generation, (data) => {
              const eic_code = _.get(data, 'unit.eic_code')
              const name = _.get(data, 'unit.name')  
              // Match unit using name for now
              const unit = _.find(units, unit => _.kebabCase(name).includes(_.kebabCase(unit.name)))
              if (unit) {
                const feature = {
                  type: 'Feature',
                  properties: { eic_code, name },
                  geometry: unit.geometry
                }
                // Now keep track of newer values
                const latestData = _.find(mostRecentData, latestData => latestData._id === eic_code)
                const values = _.get(data, 'values', [])
                values.forEach(record => {
                  const time = moment.utc(record.end_date)
                  // Check if newer
                  if (latestData && time.isSameOrBefore(moment.utc(latestData.time))) return
                  console.log(eic_code, record)
                  // If so push it
                  features.push(_.merge({
                    time: time.toDate(),
                    properties: {
                      power: _.toNumber(record.value)
                    }
                  }, feature))
                })
              }
            })
            if (features.length > 0) console.log('Found ' + features.length + ' new generation data')
            else console.log('No new generation data found')
            item.data = features
          }
        },
        writeMongoCollection: {
          collection: 'rte-generation',/*
          transform: {
            mapping: { 'properties.measureDate': 'time' },
            omit: [ 'properties.location' ],
            unitMapping: { time: { asDate: 'utc' } } 
          },*/
          chunkSize: 256
        },
        clearData: {}
      }
    },
    jobs: {
      before: {
        createStores: { id: 'memory' },
        connectMongo: {
          url: dbUrl,
          // Required so that client is forwarded from job to tasks
          clientPath: 'taskTemplate.client'
        },
        readMongoCollection: {
          clientPath: 'taskTemplate.client',
          collection: 'rte-units',
          dataPath: 'data.taskTemplate.units'
        },
        createGenerationCollection: {
          hook: 'createMongoCollection',
          clientPath: 'taskTemplate.client',
          collection: 'rte-generation',
          indices: [
            [{ time: 1, 'properties.eic_code': 1 }, { unique: true }],
            { 'properties.power': 1 },
            { 'properties.eic_code': 1, 'properties.power': 1, time: -1 },
            [{ time: 1 }, { expireAfterSeconds: ttl }], // days in s
            { geometry: '2dsphere' }                                                                                                              
          ],
        }
      },
      after: {
        disconnectMongo: {
          clientPath: 'taskTemplate.client'
        },
        removeStores: ['memory']
      },
      error: {
        disconnectMongo: {
          clientPath: 'taskTemplate.client'
        },
        removeStores: ['memory']
      }
    }
  }
}
