pipeline {
    agent any

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
