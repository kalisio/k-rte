# k-rte

[![Latest Release](https://img.shields.io/github/v/tag/kalisio/k-rte?sort=semver&label=latest)](https://github.com/kalisio/k-rte/releases)
[![Build Status](https://app.travis-ci.com/kalisio/k-rte.svg?branch=master)](https://app.travis-ci.com/kalisio/k-rte)

A [Krawler](https://kalisio.github.io/krawler/) based service to download generation data from the French gelectrical network operated by RTE.

## Description

The **k-rte** job allow to scrape generation data from the [RTE API](https://data.rte-france.com/). The downloaded data are stored within a [MongoDB](https://www.mongodb.com/) database and more precisely in 2 collections:
* the `rte-generation` collection stores the production units generation data
* the `rte-units` collection stores the production units positions

All records are stored in [GeoJson](https://fr.wikipedia.org/wiki/GeoJSON) format.

The project consists in 2 jobs:
* the `units` job scrapes the available production units according a specific cron expression. By default, every day at midnight.
* the `generation` job scrapes the generation data according a specific cron expression. By default every hour.

As the RTE API does not provide the location of the production units, the default `units` job simply read data from input files providing plant location and associated production units (taken from https://github.com/ewoken/nuclear-monitor), assuming all production units of the plant have the same location. You can update the file whenever production units are updated. If you have a better source of production units locations you should customise the job to use it.

## Configuration

### Production units

| Variable | Description |
|--- | --- |
| `DB_URL` | The database URL. The default value is `mongodb://127.0.0.1:27017/rte` |
| `DEBUG` | Enables debug output. Set it to `krawler*` to enable full output. By default it is undefined. |

### Generation data

| Variable | Description |
|--- | --- |
| `DB_URL` | The database URL. The default value is `mongodb://127.0.0.1:27017/rte` |
| `TTL` | The observations data time to live. It must be expressed in seconds and the default value is `604 800` (7 days) | 
| `CLIENT_ID` | Client ID of your application in the RTE API, required to generate the authentication token. |
| `CLIENT_SECRET` | Client secret of your application in the RTE API, required to generate the authentication token. |
| `PRODUCTION_TYPE_FILTER` | Comma-separated list of production type to be read (please refer to RTE API documentation for details). |
| `DEBUG` | Enables debug output. Set it to `krawler*` to enable full output. By default it is undefined. |

## Deployment

We personally use [Kargo](https://kalisio.github.io/kargo/) to deploy the service.

## Contributing

Please refer to [contribution section](./CONTRIBUTING.md) for more details.

## Authors

This project is sponsored by 

![Kalisio](https://s3.eu-central-1.amazonaws.com/kalisioscope/kalisio/kalisio-logo-black-256x84.png)

## License

This project is licensed under the MIT License - see the [license file](./LICENSE) for details