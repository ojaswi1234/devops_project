pipeline {
    agent any

    tools {
        nodejs 'node20'
    }

    
    environment {
        MONGO_URI = 'mongodb+srv://ojaswideep2020:123abc456dceF@genz.br57g1q.mongodb.net/'
        API_KEY = 'your-secure-api-key-here'
        // 172.17.0.1 is the Docker bridge IP that points back to your Node.js app
        HEALTH_SYNC_WEBHOOK_URL = 'https://improved-train-v9grwrrwq5fpr9p-3000.app.github.dev/webhooks/health-sync'
    }

    triggers {
        cron('* * * * *')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm install'
            }
        }

        stage('Run Polling Job') {
            steps {
                sh 'node polling-job.js'
            }
        }
    }
}