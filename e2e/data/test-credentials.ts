export const getTestCredentials = () => ({
    driverCode: process.env.TEST_DRIVER_CODE || '',
    vehicleName: process.env.TEST_VEHICLE_NAME || '',
});
