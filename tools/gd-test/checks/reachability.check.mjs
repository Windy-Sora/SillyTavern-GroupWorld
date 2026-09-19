export default {
    id: 'reachability',
    title: 'Module reachability',
    version: 1,
    order: 60,
    run({ project }) {
        const production = new Set(project.productionFiles);
        const count = visited => [...visited].filter(file => production.has(file)).length;
        return {
            counts: {
                productionModules: project.productionFiles.length,
                entryReachableModules: count(project.entryReachable),
                testReachableModules: count(project.testReachable),
            },
        };
    },
};
