import _ from 'lodash'
import moment from 'moment'
import winston from 'winston'

const DB_URL = process.env.DB_URL || 'mongodb://127.0.0.1:27017/rte'
const TTL = +process.env.TTL || (7 * 24 * 60 * 60)  // duration in seconds
const HISTORY =  +process.env.HISTORY || (1 * 24 * 60 * 60) // duration in seconds
const TYPE_FILTER = process.env.PRODUCTION_TYPE_FILTER ? process.env.PRODUCTION_TYPE_FILTER.split(',') : ['NUCLEAR']
const START_DATE = moment.utc().subtract(HISTORY, 'seconds').startOf('day')
const END_DATE = moment.utc().add(1, 'day').startOf('day')

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
      // It seems that we cannot request less than two days as
      // the API only seems to take date and not time into account
      // so request from yesterday to tomorrow
      start_date: START_DATE.format(),
      end_date: END_DATE.format()
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
            { $match: {
              'properties.power': { $exists: true },
              time: { $gte: START_DATE.format() }
            } },
            { $sort: { time: -1 } },
            {
              $group:{
                _id: "$properties.eicCode",
                time: { $first: "$time" }
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
            // console.log('Seeking generation data for ' + units.length + ' units')
            delete item.units
            const mostRecentData = _.get(item, 'mostRecentData', [])
            // console.log('Found previous generation data for ' + mostRecentData.length + ' units')
            let generation = _.get(item, 'data.actual_generations_per_unit', [])
            // Filter required production types
            if (TYPE_FILTER) {
              generation = generation.filter(data => TYPE_FILTER.includes(_.get(data, 'unit.production_type')))
            }
            let features = []
            _.forEach(generation, (data) => {
              const eicCode = _.get(data, 'unit.eic_code')
              // Match unit using name for now
              const unit = _.find(units, unit => _.get(unit, 'properties.eicCode') === eicCode)
              if (unit) {
                const feature = {
                  type: 'Feature',
                  properties: _.pick(unit.properties, ['eicCode', 'name']),
                  geometry: unit.geometry
                }
                // Now keep track of newer values
                const latestData = _.find(mostRecentData, latestData => latestData._id === eicCode)
                const values = _.get(data, 'values', [])
                values.forEach(record => {
                  const time = moment.utc(record.end_date)
                  // Check if newer
                  if (latestData && time.isSameOrBefore(moment.utc(latestData.time))) return
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
            item.data = features
            item.units = units
            item.mostRecentData = mostRecentData
            item.count = features.length
          }
        },
        log: (logger, item) => {
          logger.info(`Seeking generation data for ${item.units.length} units`)
          logger.info(`Found previous generation data for ${item.mostRecentData.length} units`)
          if (item.count > 0) {
            logger.info(`Found ${item.count} new generation data`)
          } else {
            logger.info('No new generation data found')
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
          url: DB_URL,
          // Required so that client is forwarded from job to tasks
          clientPath: 'taskTemplate.client'
        },
        readMongoCollection: {
          clientPath: 'taskTemplate.client',
          collection: 'rte-units',
          dataPath: 'data.taskTemplate.units'
        },
        createLogger: {
          loggerPath: 'taskTemplate.logger',
          Console: {
            format: winston.format.printf(log => winston.format.colorize().colorize(log.level, `${log.level}: ${log.message}`)),
            level: 'verbose'
          }
        },
        createGenerationCollection: {
          hook: 'createMongoCollection',
          clientPath: 'taskTemplate.client',
          collection: 'rte-generation',
          indices: [
            { 'properties.eicCode': 1 },
            { 'properties.power': 1 },
            { 'properties.eicCode': 1, time: -1 },
            { 'properties.eicCode': 1, 'properties.power': 1, time: -1 },
            [{ time: 1 }, { expireAfterSeconds: TTL }], // days in s
            { geometry: '2dsphere' }                                                                                                              
          ],
        }
      },
      after: {
        disconnectMongo: {
          clientPath: 'taskTemplate.client'
        },
        removeLogger: {
          loggerPath: 'taskTemplate.logger'
        },
        removeStores: ['memory']
      },
      error: {
        disconnectMongo: {
          clientPath: 'taskTemplate.client'
        },
        removeLogger: {
          loggerPath: 'taskTemplate.logger'
        },
        removeStores: ['memory']
      }
    }
  }
}
