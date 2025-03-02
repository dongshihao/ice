/* eslint-disable import/no-dynamic-require */
/**
 * 检测 ICE 组件的依赖问题
 *  - 部分代码直接借鉴了 duplicate-package-checker-webpack-plugin
 */
const path = require('path');
const findRoot = require('find-root');
const semver = require('semver');
const bizComponentsVersion = require('./bizComponentsVersion');
const deprecatedComponents = require('./deprecatedComponents');

const depModules = {};

module.exports = class CheckDepsPlugin {
  constructor(options) {
    this.pkg = options.pkg || {};
    this.log = options.log;
  }

  apply(compiler) {
    compiler.hooks.emit.tapAsync('CheckDepsPlugin', (compilation, callback) => {
      compilation.modules.forEach((module) => {
        if (!module.resource) {
          return;
        }

        const closestPackage = getClosestPackage(module.resource);

        // Skip module if no closest package is found
        if (!closestPackage) {
          return;
        }

        const pkg = closestPackage.package;

        if (!depModules[pkg.name]) {
          depModules[pkg.name] = [pkg.version];
        } else if (depModules[pkg.name].indexOf(pkg.version) === -1) {
          depModules[pkg.name].push(pkg.version);
        }
      });

      // 1. 多份基础组件
      const baseComponentDeps = ['@icedesign/base', 'cn-next', '@ali/ice'].filter((name) => depModules[name]);
      if (baseComponentDeps.length > 1) {
        this.log.warn(`项目依赖了多份基础组件 ${baseComponentDeps}，建议通过配置 buildConfig.uniteBaseComponent 优化`);
      }

      // 2. 业务组件与基础组件的版本对应关系
      const pkgDirectDeps = this.pkg.dependencies || {};
      const depFdNext = pkgDirectDeps['cn-next'];
      const depFeNext = pkgDirectDeps['@ali/ice'] || pkgDirectDeps['@icedesign/base'] || pkgDirectDeps['cn-next'];

      if (depFeNext && !depFdNext) {
        // 只依赖了 0.x 的项目应该使用 0.x 的业务组件
        Object.keys(depModules).forEach((moduleName) => {
          checkBizComponentVersion({
            npmName: moduleName,
            npmVersion: depModules[moduleName][0],
            baseVersion: '0.x',
            log: this.log,
          });
        });
      }

      if (depFdNext && !depFeNext) {
        // 只依赖了 1.x 的项目应该使用 1.x 的业务组件
        Object.keys(depModules).forEach((moduleName) => {
          checkBizComponentVersion({
            npmName: moduleName,
            npmVersion: depModules[moduleName][0],
            baseVersion: '1.x',
            log: this.log,
          });
        });
      }

      // 3. 不维护的业务组件
      Object.keys(depModules).forEach((moduleName) => {
        const deprecatedMsg = deprecatedComponents[moduleName];
        if (deprecatedMsg) {
          this.log.warn(deprecatedMsg);
        }
      });

      callback();
    });
  }
};

// Get closest package definition from path
function getClosestPackage(modulePath) {
  let root;
  let pkg;

  // Catch findRoot or require errors
  try {
    root = findRoot(modulePath);
    // eslint-disable-next-line
    pkg = require(path.join(root, 'package.json'));
  } catch (e) {
    return null;
  }

  // If the package.json does not have a name property, try again from
  // one level higher.
  // https://github.com/jsdnxx/find-root/issues/2
  // https://github.com/date-fns/date-fns/issues/264#issuecomment-265128399
  if (!pkg.name) {
    return getClosestPackage(path.resolve(root, '..'));
  }

  return {
    package: pkg,
    path: root,
  };
}

function checkBizComponentVersion({ npmName, npmVersion, baseVersion, log }) {
  if (!bizComponentsVersion[npmName]) {
    // 未统计到或者 0.x&1.x 兼容的业务组件
    return;
  }

  const semverVersion = bizComponentsVersion[npmName][baseVersion];

  if (!semverVersion) {
    // 没有对应的（未升级）
    log.warn(`${npmName} 暂时没有符合基础组件 ${baseVersion} 的版本，建议联系 ICE 团队协助升级`);
  }

  if (!semver.satisfies(npmVersion, semverVersion)) {
    // 不符合版本
    log.warn(`项目使用的基础组件版本是 ${baseVersion}，业务组件 ${npmName}@${npmVersion} 不符合版本要求 ${semverVersion}，建议选择正确的组件版本`);
  }
}
